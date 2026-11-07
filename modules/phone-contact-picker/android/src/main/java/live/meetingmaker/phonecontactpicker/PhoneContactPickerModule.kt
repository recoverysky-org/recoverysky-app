package live.meetingmaker.phonecontactpicker

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract.CommonDataKinds.Phone
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Support contacts spec D2: ACTION_PICK with the Phone content type returns a URI the app may
// read without the contacts read permission (Android's own guidance: the picker grants a
// temporary read grant on the one row it returns), unlike expo-contacts, which re-queries the
// contacts provider by id and so needs the permission. The request code only has to be unique
// within this app's activity results.
// ADDED 2026-11-06. The permission names are deliberately not spelled out anywhere in this
// directory: supportPolicy.test.ts greps modules/phone-contact-picker for them.
private const val REQUEST_PICK_PHONE = 0x5CAF

// Expo infers nothing here: the explicit codes are what the JS wrapper maps
// (pickerErrorCodeFrom in app/services/support/supportContactsLogic.ts). Messages carry no
// contact data, because the rejection's message can reach the app's logs.
class NoPickerException : CodedException("ERR_NO_PICKER", "No app on this phone can pick a contact", null)
class NoNumberException : CodedException("ERR_NO_NUMBER", "The picked contact has no readable number", null)
class InProgressException : CodedException("ERR_IN_PROGRESS", "A contact pick is already open", null)

class PhoneContactPickerModule : Module() {
  // The one open pick. Read and written only on the main thread (see runOnQueue below).
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("PhoneContactPicker")

    AsyncFunction("pickPhoneContact") { promise: Promise ->
      if (pending != null) throw InProgressException()
      // ADDED 2026-11-06: no activity (app backgrounded mid-call) is "nothing to pick with",
      // the same answer iOS gives for a missing presenter. throwingActivity would reject with
      // Expo's ERR_MISSING_ACTIVITY, which the JS side can only call "unknown".
      val activity = appContext.currentActivity ?: throw NoPickerException()
      val intent = Intent(Intent.ACTION_PICK).apply { type = Phone.CONTENT_TYPE }
      // No resolveActivity() first: on Android 11+ that needs a <queries> entry to see the
      // contacts app, while starting the implicit intent does not. A missing handler throws here.
      try {
        activity.startActivityForResult(intent, REQUEST_PICK_PHONE)
      } catch (e: ActivityNotFoundException) {
        throw NoPickerException()
      }
      pending = promise
    }.runOnQueue(Queues.MAIN)
    // ADDED 2026-11-06: main queue, not Expo's default modules queue. OnActivityResult is
    // delivered on the main thread, so running the call there too means `pending` is never
    // touched from two threads, and the activity is started from the UI thread. (expo-sharing
    // uses the default queue for the same shape; the brief's code did too.)

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_PICK_PHONE) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      val uri = payload.data?.data
      // Back button, or a picker that returned nothing: a cancel, never an error.
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      val picked = readPhoneRow(uri)
      if (picked == null) promise.reject(NoNumberException()) else promise.resolve(picked)
    }
  }

  /** Reads name and number from the one Data row the picker returned. Null when unreadable or empty. */
  private fun readPhoneRow(uri: Uri): Map<String, String>? {
    val resolver = appContext.reactContext?.contentResolver ?: return null
    val projection = arrayOf(Phone.NUMBER, Phone.DISPLAY_NAME)
    return try {
      resolver.query(uri, projection, null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return null
        val number = cursor.getString(cursor.getColumnIndexOrThrow(Phone.NUMBER))?.trim().orEmpty()
        val name = cursor.getString(cursor.getColumnIndexOrThrow(Phone.DISPLAY_NAME))?.trim().orEmpty()
        if (number.isEmpty()) null else mapOf("name" to name, "number" to number)
      }
    } catch (e: SecurityException) {
      // A picker app that did not grant read access on its result URI. Reported as "no
      // readable number" rather than asking for a permission (spec D2: we never ask).
      null
    }
  }
}
