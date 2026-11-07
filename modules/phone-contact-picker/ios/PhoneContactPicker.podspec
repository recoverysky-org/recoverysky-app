Pod::Spec.new do |s|
  s.name           = 'PhoneContactPicker'
  s.version        = '1.0.0'
  s.summary        = "RecoverySky's permission-free phone-number picker"
  s.description    = 'Presents CNContactPickerViewController limited to phone numbers; no contacts authorization is needed.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
