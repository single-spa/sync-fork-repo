const shell = require("shelljs");
const log4js = require("log4js");
const { Octokit } = require("@octokit/rest");
const program = require("commander");
const { getJSON } = require("../util");
const colors = require("colors");
// shell.config.silent = true;

let arguments = process.argv.splice(2);
let langCode = arguments[0];
let reviewers = arguments[1];
const username = arguments[2];
const token = arguments[3];
const email = arguments[4];

program // options
  .option("-d, --delete", "Delete repo when done")
  .parse(process.argv);

const owner = "single-spa";
const repository = "single-spa.js.org";

log4js.configure({
  appenders: { info: { type: "file", filename: "info.log" } },
  categories: { default: { appenders: ["info"], level: "info" } },
});

const logger = log4js.getLogger(langCode);
logger.level = "info";

const originalUrl = `https://github.com/${owner}/${repository}.git`;
// const username = process.env.USER_NAME;
// const token = process.env.GITHUB_ACCESS_TOKEN;

const transRepoName = `${langCode}.${repository}`;
const transUrl = `https://${username}:${token}@github.com/${owner}/${transRepoName}.git`;
const defaultBranch = "master";

console.log(`\nBegin to sync the ${transRepoName}`.green.bold);
// Set up
if (shell.cd("repo").code !== 0) {
  shell.mkdir("repo");
  shell.cd("repo");
}

shell.exec(`git clone ${transUrl} ${transRepoName}`);
console.log("Finished cloning.");
shell.cd(transRepoName);
shell.exec(`git remote add ${repository} ${originalUrl}`);

shell.exec(`git config user.name ${username}`);
shell.exec(`git config user.email ${email}`);
shell.exec(`git config --global pull.ff only`);

// Pull from {source}/master
const output = shell.exec(`git pull ${repository} ${defaultBranch}`).stdout;

console.log(`There are new commits in ${repository}.`);
shell.exec(`git commit -am "merging all conflicts"`);
const hash = shell.exec(`git rev-parse ${defaultBranch}`).stdout;
const shortHash = hash.substr(0, 8);
const syncBranch = `sync-${shortHash}`;

if (shell.exec(`git checkout ${syncBranch}`).code !== 0) {
  shell.exec(`git checkout -b ${syncBranch}`);

  const lines = output.split("\n");
  // Commit all merge conflicts
  const conflictLines = lines.filter((line) => line.startsWith("CONFLICT"));
  const conflictFiles = conflictLines.map((line) =>
    line.substr(line.lastIndexOf(" ") + 1)
  );

  // If no conflicts, merge directly into master
  if (conflictFiles.length === 0) {
    console.log(
      "\nNo conflicts found. Committing directly to master.".green.bold
    );
    shell.exec(`git checkout ${defaultBranch}`);
    shell.exec(`git merge ${syncBranch}`);
    shell.exec(`git push origin ${defaultBranch}`);
    shell.exec(`git remote get-url origin`);
  } else {
    console.log("conflict files: ", conflictFiles.join("\n"));
    // Create a new pull request, listing all conflicting files
    shell.exec(`git push --set-upstream origin ${syncBranch}`);

    const title = `Sync with ${repository} @ ${shortHash}`;

    const conflictsText = `
    The following files have conflicts and may need new translations:

      ${conflictFiles
        .map(
          (file) =>
            ` * [ ] [${file}](/${owner}/${repository}/commits/master/${file})`
        )
        .join("\n")}

    Please fix the conflicts by pushing new commits to this pull request, either by editing the files directly on GitHub or by checking out this branch.
    `;

    const body = `
    This PR was automatically generated.

    Merge changes from [single-spa/single-spa.js.orgc](https://github.com/single-spa/single-spa.js.org) at ${shortHash}

    ${conflictFiles.length > 0 ? conflictsText : "No conflicts were found."}

    ## DO NOT SQUASH MERGE THIS PULL REQUEST!

    Doing so will "erase" the commits from master and cause them to show up as conflicts the next time we merge.
    `;

    let retryNum = 0;
    async function createPullRequest() {
      console.log(`It's ready to create a pull request.`);
      retryNum++;
      const octokit = new Octokit({
        auth: `token ${token}`,
        previews: ["hellcat-preview"],
      });

      try {
        const {
          data: { number },
        } = await octokit.pulls.create({
          owner,
          repo: transRepoName,
          title,
          body,
          head: syncBranch,
          base: defaultBranch,
        });
        console.log(
          `The pull request is created successly,its number is ${number}`
        );
        await octokit.pulls.createReviewRequest({
          owner,
          repo: transRepoName,
          pull_number: number,
          reviewers: reviewers.split(","), // api changes, reviewers need to be an array
        });
        console.log(`\nThe review request is created successly`.rainbow.bold);
      } catch (err) {
        console.log(err);
        retryNum < 5 && createPullRequest();
      }
    }
    createPullRequest();
  }
} else {
  console.log(
    `\nThe pull request of sync-${shortHash} is pending `.rainbow.bold
  );
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random#Getting_a_random_integer_between_two_values
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomSubset(array, n) {
  if (array.length <= n) {
    return array;
  }
  const copy = [...array];
  let result = [];
  while (result.length < n) {
    const i = getRandomInt(0, copy.length);
    result = result.concat(copy.splice(i, 1));
  }
  return result;
}
