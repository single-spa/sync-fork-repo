const shell = require('shelljs');
const log4js = require('log4js');
const { Octokit } = require("@octokit/rest")
const program = require('commander');
const {getJSON} = require('../util');
// shell.config.silent = true;


program // options
  .option('-d, --delete', 'Delete repo when done')
  .parse(process.argv);

const owner = 'sunzefang'
const repository = 'doc';
const langCode='zh-hans';

log4js.configure({
  appenders: { info: { type: 'file', filename: 'info.log' } },
  categories: { default: { appenders: ['info'], level: 'info' } }
});

const logger = log4js.getLogger('info');
logger.level = 'info';

const originalUrl = `https://github.com/${owner}/${repository}.git`;
const username = process.env.USER_NAME;
const token = process.env.GITHUB_ACCESS_TOKEN;

const transRepoName = `${langCode}.${repository}`;
const transUrl = `https://${username}:${token}@github.com/guguji5/${transRepoName}.git`;
const defaultBranch = 'master';

let USER_NAME = shell.exec('echo $USER_NAME').stdout
logger.info(`USER_NAME is ${USER_NAME}`)
let SHELL = shell.exec('echo $SHELL').stdout
logger.info(`SHELL is ${SHELL}`)

logger.info(`Begin to sync the ${transRepoName}`)
// Set up
if (shell.cd('repo').code !== 0) {
  shell.mkdir('repo');
  shell.cd('repo');
}

if (shell.cd(transRepoName).code !== 0) {
  logger.info("Can't find translation repo locally. Cloning...");
  shell.exec(`git clone ${transUrl} ${transRepoName}`);
  logger.info('Finished cloning.');
  shell.cd(transRepoName);
  shell.exec(`git remote add ${repository} ${originalUrl}`);
}else{
  logger.info("The translation repo exists");
  // Pull from our own origin
  shell.exec(`git checkout ${defaultBranch}`);
  shell.exec(`git pull origin ${defaultBranch}`);

  shell.exec(`git remote add ${repository} ${originalUrl}`);
}

shell.exec(`git config user.name ${process.env.USER_NAME}`);
shell.exec(`git config user.email ${process.env.USER_EMAIL}`);

// Pull from {source}/master
const output = shell.exec(`git pull ${repository} ${defaultBranch}`).stdout;

if (output.includes('Already up to date.') || output.includes('Already up-to-date.')) {
  logger.info(`We are already up to date with ${repository}.`);
}else{
  logger.info(`There are new commits in ${repository}.`);
  const hash = shell.exec(`git rev-parse ${defaultBranch}`).stdout;
  const shortHash = hash.substr(0, 8);
  const syncBranch = `sync-${shortHash}`;
  if (shell.exec(`git checkout ${syncBranch}`).code !== 0) {
    shell.exec(`git checkout -b ${syncBranch}`);
  
    const lines = output.split('\n');
    // Commit all merge conflicts
    const conflictLines = lines.filter(line => line.startsWith('CONFLICT'));
    const conflictFiles = conflictLines.map(line =>
      line.substr(line.lastIndexOf(' ') + 1),
    );

    shell.exec(`git commit -am "merging all conflicts"`);

    // whatever conflicts, always create a pull request.
    if (conflictFiles.length === 0) {
      logger.info('No conflicts found. Committing directly to master.');
      shell.exec(`git checkout ${defaultBranch}`);
      shell.exec(`git merge ${syncBranch}`);
      shell.exec(`git push origin ${defaultBranch}`);
    }else{
      logger.warn('conflict files: ', conflictFiles.join('\n'));
      // Create a new pull request, listing all conflicting files
      shell.exec(`git push --set-upstream origin ${syncBranch}`);

      const title = `Sync with ${repository} @ ${shortHash}`;

      const conflictsText = `
      The following files have conflicts and may need new translations:

        ${conflictFiles
          .map(
            file =>
              ` * [ ] [${file}](/${owner}/${repository}/commits/master/${file})`,
          )
          .join('\n')}

      Please fix the conflicts by pushing new commits to this pull request, either by editing the files directly on GitHub or by checking out this branch.
      `;

      const body = `
      This PR was automatically generated.

      Merge changes from [sunzefang/doc](https://github.com/sunzefang/doc) at ${shortHash}

      ${conflictFiles.length > 0 ? conflictsText : 'No conflicts were found.'}

      ## DO NOT SQUASH MERGE THIS PULL REQUEST!

      Doing so will "erase" the commits from master and cause them to show up as conflicts the next time we merge.
      `;

      logger.info(`It's ready to create a pull request.`);
      async function createPullRequest() {
        const octokit = new Octokit({
          auth: `token ${token}`,
          previews: ['hellcat-preview'],
        });
        try{
          const {
            data: {number},
          } = await octokit.pulls.create({
            owner:'guguji5',
            repo: transRepoName,
            title,
            body,
            head: syncBranch,
            base: defaultBranch,
          });
          logger.info(`The pull request is created successly,its number is ${number}`);
          await octokit.pulls.createReviewRequest({
            owner:'guguji5',
            repo: transRepoName,
            pull_number:number,
            // reviewers: getRandomSubset(maintainers, 3),
            reviewers: ["guguji5"],
          });
          logger.info(`The review request is created successly`);
        }
        catch(err){
          console.log(err)
          logger.error(`the err is \n ${err}`)
        }
      }
      createPullRequest();
    }
  }else{
    logger.info(`The pull request of sync-${shortHash} is pending `);
  }
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
