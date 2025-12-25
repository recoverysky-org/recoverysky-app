import { Translations } from "./en"

const hi: Translations = {
  common: {
    ok: "ठीक है",
    cancel: "रद्द करें",
    back: "वापस",
    logOut: "लॉग आउट",
  },
  welcomeScreen: {
    postscript: "शायद आपका ऐप ऐसा नहीं दिखता।",
    readyForLaunch: "आपका ऐप, लॉन्च के लिए लगभग तैयार!",
    exciting: "(ओह, यह रोमांचक है!)",
    letsGo: "चलें!",
  },
  errorScreen: {
    title: "कुछ गलत हो गया!",
    friendlySubtitle: "यह वह स्क्रीन है जो आपके उपयोगकर्ता प्रोडक्शन में देखेंगे जब कोई त्रुटि होगी।",
    reset: "ऐप रीसेट करें",
    traceTitle: "%{name} स्टैक से त्रुटि",
  },
  emptyStateComponent: {
    generic: {
      heading: "बहुत खाली... बहुत उदास",
      content: "अभी तक कोई डेटा नहीं मिला। रिफ्रेश करने के लिए बटन दबाएं।",
      button: "फिर से प्रयास करें",
    },
  },
  errors: {
    invalidEmail: "अमान्य ईमेल पता।",
  },
  loginScreen: {
    logIn: "लॉग इन",
    enterDetails: "गुप्त जानकारी अनलॉक करने के लिए नीचे अपना विवरण दर्ज करें।",
    emailFieldLabel: "ईमेल",
    passwordFieldLabel: "पासवर्ड",
    emailFieldPlaceholder: "अपना ईमेल पता दर्ज करें",
    passwordFieldPlaceholder: "सुपर सीक्रेट पासवर्ड यहाँ",
    tapToLogIn: "लॉग इन करने के लिए टैप करें!",
    hint: "संकेत: आप किसी भी ईमेल और अपना पसंदीदा पासवर्ड उपयोग कर सकते हैं :)",
  },
  mainNavigator: {
    homeTab: "होम",
    liveTab: "लाइव",
    meetingsTab: "मीटिंग्स",
    scheduleTab: "शेड्यूल",
    profileTab: "प्रोफाइल",
  },
  homeScreen: {
    title: "होम",
    placeholder: "डैशबोर्ड सामग्री जल्द आ रही है",
  },
  meetingsScreen: {
    title: "मीटिंग्स",
    placeholder: "मीटिंग सूची जल्द आ रही है",
  },
  scheduleScreen: {
    title: "शेड्यूल",
    placeholder: "शेड्यूल व्यू जल्द आ रहा है",
  },
  liveScreen: {
    title: "अभी लाइव",
    noMeetings: "अभी कोई मीटिंग लाइव नहीं है",
    lastRefresh: "अंतिम जांच: {{time}}",
    joinMeeting: "जुड़ें",
    meetingCount: "{{count}} मीटिंग्स लाइव",
  },
  profileScreen: {
    title: "प्रोफाइल",
    placeholder: "प्रोफाइल सेटिंग्स जल्द आ रही हैं",
  },
  devScreen: {
    title: "डेवलपर टूल्स",
    reportBugs: "बग रिपोर्ट करें",
    reactotron: "Reactotron को भेजें",
    androidReactotronHint: "अगर यह काम नहीं करता, सुनिश्चित करें कि Reactotron चल रहा है।",
    iosReactotronHint: "अगर यह काम नहीं करता, सुनिश्चित करें कि Reactotron चल रहा है।",
    macosReactotronHint: "अगर यह काम नहीं करता, सुनिश्चित करें कि Reactotron चल रहा है।",
    webReactotronHint: "अगर यह काम नहीं करता, सुनिश्चित करें कि Reactotron चल रहा है।",
    windowsReactotronHint: "अगर यह काम नहीं करता, सुनिश्चित करें कि Reactotron चल रहा है।",
  },
}

export default hi
