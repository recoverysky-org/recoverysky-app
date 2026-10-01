/**
 * RETIRED 2026-10-01 from meetingmaker by auth0/scripts/retire-action.mjs.
 * This is the code that was deployed there. To restore, copy into
 * auth0/actions/meetingmaker/, set the secrets in the dashboard, run deploy-actions.sh.
 *
 * @auth0-action   Create Firebase User
 * @auth0-trigger  post-login
 * @auth0-runtime  node22
 * @auth0-dependency axios@1.7.7
 * @auth0-secret   PASSWORD
 * @auth0-secret   PREFIX
 */
/**
* Handler that will be called during the execution of a PostLogin flow.
*
* @param {Event} event - Details about the user and the context in which they are logging in.
* @param {PostLoginAPI} api - Interface whose methods can be used to change the behavior of the login.
*/
exports.onExecutePostLogin = async (event, api) => {

  if (api.rules.wasExecuted('rul_1IZYpHVv7peL8WYC')) { 
 		return;
 	} 

 	// YOUR_CODE_HERE
  if (event.user.app_metadata.user_created) {
    return;
  }

	var axios = require('axios');
  await axios.post(`https://api.irecovery.app/${event.secrets.PREFIX}/createUser/`, {
      user: event.user,
    	password: event.secrets.PASSWORD
  },{
    headers: {
      'Authorization': `Bearer ${api.accessToken}`,
      'Content-Type': 'application/json'
    }
  }).then(rv => {
    if (rv.data.created) {
      console.log(`Successfully Created Firebase User ${event.user.user_id}`);
      api.user.setAppMetadata("user_created", true);
   	} else {
      console.error(`Failed to Create Firebase User ${event.user.user_id}: ${rv.data.error}`);
    }
  }).catch(error => {
      console.error(`Error Creating Firebase User ${event.user.user_id}: ${error}`);
  });
};
/**
* Handler that will be invoked when this action is resuming after an external redirect. If your
* onExecutePostLogin function does not perform a redirect, this function can be safely ignored.
*
* @param {Event} event - Details about the user and the context in which they are logging in.
* @param {PostLoginAPI} api - Interface whose methods can be used to change the behavior of the login.
*/
// exports.onContinuePostLogin = async (event, api) => {
// };
