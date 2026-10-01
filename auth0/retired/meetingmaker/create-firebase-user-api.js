/**
 * RETIRED 2026-10-01 from meetingmaker (removed in the dashboard; code saved from a read-only
 * Management API read on 2026-09-30). This is the code that was deployed there. It never did
 * anything: the post-user-registration handler only declares a nested post-login handler.
 *
 * @auth0-action   Create Firebase User API
 * @auth0-trigger  post-user-registration
 * @auth0-runtime  node22
 * @auth0-dependency axios@1.7.7
 * @auth0-secret   PASSWORD
 * @auth0-secret   PREFIX
 */
/**
* Handler that will be called during the execution of a PostUserRegistration flow.
*
* @param {Event} event - Details about the context and user that has registered.
* @param {PostUserRegistrationAPI} api - Methods and utilities to help change the behavior after a signup.
*/
exports.onExecutePostUserRegistration = async (event, api) => {
  /**
 * This Action was migrated from Rule.
 * Rule name: Create Firebase User
 * Rule ID: rul_1IZYpHVv7peL8WYC
 * Created on 11/18/2024
 */

/**
* Handler that will be called during the execution of a PostLogin flow.
*
* @param {Event} event - Details about the user and the context in which they are logging in.
* @param {PostLoginAPI} api - Interface whose methods can be used to change the behavior of the login.
*/
exports.onExecutePostLogin = async (event, api) => {
	/**
 	 * The following code block will skip this Action if Rule '{{ruleName}'
 	 * was previously executed in the transaction in order to avoid duplication
 	 * of logic.
 	 */
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
};
