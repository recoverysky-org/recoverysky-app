import ContactsUI
import ExpoModulesCore
import UIKit

// Support contacts spec D2: Apple's picker runs out of process; "the app using contact picker
// view does not need access to the user's contacts and the user will not be prompted". Limiting
// the displayed keys to phone numbers and selecting a property makes the person tap the exact
// number, so a contact with three numbers never has to be disambiguated by us.
// ADDED 2026-11-06: why displayedPropertyKeys + predicateForSelectionOfProperty. Without them the
// picker hands back a whole CNContact on the first tap, and reading its numbers would need keys
// the picker never fetched (an ObjC exception) or contacts authorization (which spec D2 rules
// out, and which is why app.json no longer carries a contacts usage string). With them the
// delegate's contactPicker(_:didSelect contactProperty:) fires with exactly one number.
// Expo derives the JS error code from the class name: NoPickerException → ERR_NO_PICKER. The
// JS wrapper maps those codes (pickerErrorCodeFrom), so renaming a class changes the contract.
internal final class NoPickerException: Exception {
  override var reason: String { "No view controller to present the contact picker from" }
}
internal final class NoNumberException: Exception {
  override var reason: String { "The picked contact has no readable number" }
}
internal final class InProgressException: Exception {
  override var reason: String { "A contact pick is already open" }
}

public class PhoneContactPickerModule: Module {
  // The one open pick, and the delegate kept alive for it: CNContactPickerViewController holds
  // its delegate weakly, so without this strong reference the callbacks never arrive and the
  // JS promise would hang. Both are touched only on the main queue.
  private var pending: Promise?
  private var pickerDelegate: PhonePickerDelegate?
  // ADDED 2026-11-06: weak, so it reads nil when UIKit refused the present (nothing retains the
  // picker then) and tells a real open pick from a stale `pending` at the in-progress check.
  private weak var openPicker: CNContactPickerViewController?

  public func definition() -> ModuleDefinition {
    Name("PhoneContactPicker")

    AsyncFunction("pickPhoneContact") { (promise: Promise) in
      // ADDED 2026-11-06: ERR_IN_PROGRESS only for a picker that really is on screen. A `pending`
      // left behind by a refused present or a dismiss no callback reported would otherwise reject
      // every later pick until the app restarts, so it resolves as a cancel and this pick proceeds.
      // Dropping the old delegate here also means its picker can never settle the new promise.
      if let stale = self.pending {
        if self.openPicker?.presentingViewController != nil {
          throw InProgressException()
        }
        self.pending = nil
        self.pickerDelegate = nil
        stale.resolve(nil)
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        throw NoPickerException()
      }
      let picker = CNContactPickerViewController()
      picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
      // Contacts without a number are greyed out rather than tappable into a dead end.
      picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
      picker.predicateForSelectionOfProperty = NSPredicate(format: "key == 'phoneNumbers'")
      let delegate = PhonePickerDelegate(
        onPick: { [weak self] property in self?.finish(with: property) },
        onCancel: { [weak self] in self?.finish(with: nil) }
      )
      self.pickerDelegate = delegate
      picker.delegate = delegate
      // ADDED 2026-11-06: not known yet whether swipe-down reaches contactPickerDidCancel; that is
      // unverified until the device pass, which is why this second path exists. Expo's file picker
      // wires the same delegate (expo-file-system FilePickingHandler.swift). If both fire, finish()
      // runs once: the first call clears `pending` and frees the delegate that makes the second.
      picker.presentationController?.delegate = delegate
      self.openPicker = picker
      self.pending = promise
      presenter.present(picker, animated: true)
    }.runOnQueue(.main)
  }

  private func finish(with property: CNContactProperty?) {
    guard let promise = pending else { return }
    pending = nil
    pickerDelegate = nil
    openPicker = nil
    // Cancel resolves null, never rejects.
    // CHANGED 2026-11-06: this used to say "button or swipe-down" with no evidence for the swipe.
    // Cancel means contactPickerDidCancel or presentationControllerDidDismiss, whichever fires.
    guard let property = property else {
      promise.resolve(nil)
      return
    }
    guard let phone = property.value as? CNPhoneNumber, !phone.stringValue.isEmpty else {
      promise.reject(NoNumberException())
      return
    }
    promise.resolve(["name": displayName(of: property.contact), "number": phone.stringValue])
  }

  /// The picker returns the keys it displayed plus what it needed for the name; reading an
  /// unfetched key throws an ObjC exception, so every read is guarded by isKeyAvailable.
  private func displayName(of contact: CNContact) -> String {
    let descriptor = CNContactFormatter.descriptorForRequiredKeys(for: .fullName)
    if contact.areKeysAvailable([descriptor]),
       let full = CNContactFormatter.string(from: contact, style: .fullName),
       !full.isEmpty {
      return full
    }
    var parts: [String] = []
    if contact.isKeyAvailable(CNContactGivenNameKey) { parts.append(contact.givenName) }
    if contact.isKeyAvailable(CNContactFamilyNameKey) { parts.append(contact.familyName) }
    let joined = parts.filter { !$0.isEmpty }.joined(separator: " ")
    if !joined.isEmpty { return joined }
    if contact.isKeyAvailable(CNContactOrganizationNameKey) { return contact.organizationName }
    return ""
  }
}

private final class PhonePickerDelegate: NSObject, CNContactPickerDelegate,
  UIAdaptivePresentationControllerDelegate {
  private let onPick: (CNContactProperty) -> Void
  private let onCancel: () -> Void

  init(onPick: @escaping (CNContactProperty) -> Void, onCancel: @escaping () -> Void) {
    self.onPick = onPick
    self.onCancel = onCancel
  }

  func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) {
    onPick(contactProperty)
  }

  func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
    onCancel()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    onCancel()
  }
}
