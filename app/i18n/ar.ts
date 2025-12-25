import { Translations } from "./en"

const ar: Translations = {
  common: {
    ok: "نعم",
    cancel: "حذف",
    back: "خلف",
    logOut: "تسجيل خروج",
  },
  welcomeScreen: {
    postscript:
      "ربما لا يكون هذا هو الشكل الذي يبدو عليه تطبيقك مالم يمنحك المصمم هذه الشاشات وشحنها في هذه الحالة",
    readyForLaunch: "تطبيقك تقريبا جاهز للتشغيل",
    exciting: "اوه هذا مثير",
    letsGo: "لنذهب",
  },
  errorScreen: {
    title: "هناك خطأ ما",
    friendlySubtitle:
      "هذه هي الشاشة التي سيشاهدها المستخدمون في عملية الانتاج عند حدوث خطأ.",
    reset: "اعادة تعيين التطبيق",
    traceTitle: "خطأ من مجموعة %{name}",
  },
  emptyStateComponent: {
    generic: {
      heading: "فارغة جداً....حزين",
      content: "لا توجد بيانات حتى الآن. حاول النقر فوق الزر لتحديث التطبيق او اعادة تحميله.",
      button: "لنحاول هذا مرّة أخرى",
    },
  },
  errors: {
    invalidEmail: "عنوان البريد الالكتروني غير صالح",
  },
  loginScreen: {
    logIn: "تسجيل الدخول",
    enterDetails: "ادخل التفاصيل الخاصة بك ادناه لفتح معلومات سرية للغاية.",
    emailFieldLabel: "البريد الالكتروني",
    passwordFieldLabel: "كلمة السر",
    emailFieldPlaceholder: "ادخل بريدك الالكتروني",
    passwordFieldPlaceholder: "كلمة السر هنا فائقة السر",
    tapToLogIn: "انقر لتسجيل الدخول!",
    hint: "تلميح: يمكنك استخدام اي عنوان بريد الكتروني وكلمة السر المفضلة لديك",
  },
  mainNavigator: {
    homeTab: "الرئيسية",
    meetingsTab: "الاجتماعات",
    scheduleTab: "الجدول",
    profileTab: "الملف الشخصي",
  },
  homeScreen: {
    title: "الرئيسية",
    placeholder: "محتوى لوحة التحكم قريباً",
  },
  meetingsScreen: {
    title: "الاجتماعات",
    placeholder: "قائمة الاجتماعات قريباً",
  },
  scheduleScreen: {
    title: "الجدول",
    placeholder: "عرض الجدول قريباً",
  },
  profileScreen: {
    title: "الملف الشخصي",
    placeholder: "إعدادات الملف الشخصي قريباً",
  },
  devScreen: {
    title: "أدوات المطور",
    reportBugs: "الإبلاغ عن الأخطاء",
    reactotron: "إرسال إلى Reactotron",
    androidReactotronHint: "إذا لم ينجح، تأكد من تشغيل Reactotron وأعد تحميل التطبيق",
    iosReactotronHint: "إذا لم ينجح، تأكد من تشغيل Reactotron وأعد تحميل التطبيق",
    macosReactotronHint: "إذا لم ينجح، تأكد من تشغيل Reactotron وأعد تحميل التطبيق",
    webReactotronHint: "إذا لم ينجح، تأكد من تشغيل Reactotron وأعد تحميل التطبيق",
    windowsReactotronHint: "إذا لم ينجح، تأكد من تشغيل Reactotron وأعد تحميل التطبيق",
  },
}

export default ar
