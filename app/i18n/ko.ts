import { Translations } from "./en"

const ko: Translations = {
  common: {
    ok: "확인",
    cancel: "취소",
    back: "뒤로",
    logOut: "로그아웃",
  },
  welcomeScreen: {
    postscript: "아마 이것은 당신의 앱이 보이는 모습이 아닐 것입니다.",
    readyForLaunch: "당신의 앱, 거의 출시 준비 완료!",
    exciting: "(오, 이건 신나요!)",
    letsGo: "가자!",
  },
  errorScreen: {
    title: "문제가 발생했습니다!",
    friendlySubtitle: "이것은 오류가 발생했을 때 프로덕션에서 사용자가 보게 될 화면입니다.",
    reset: "앱 재설정",
    traceTitle: "%{name} 스택에서 오류",
  },
  emptyStateComponent: {
    generic: {
      heading: "너무 비어있어요... 슬퍼요",
      content: "아직 데이터가 없습니다. 버튼을 눌러 새로고침하세요.",
      button: "다시 시도해봐요",
    },
  },
  errors: {
    invalidEmail: "잘못된 이메일 주소입니다.",
  },
  loginScreen: {
    logIn: "로그인",
    enterDetails: "비밀 정보를 잠금 해제하려면 아래에 세부 정보를 입력하세요.",
    emailFieldLabel: "이메일",
    passwordFieldLabel: "비밀번호",
    emailFieldPlaceholder: "이메일 주소를 입력하세요",
    passwordFieldPlaceholder: "여기에 초비밀 비밀번호",
    tapToLogIn: "탭하여 로그인!",
    hint: "힌트: 아무 이메일과 원하는 비밀번호를 사용할 수 있습니다 :)",
  },
  mainNavigator: {
    homeTab: "홈",
    meetingsTab: "미팅",
    scheduleTab: "일정",
    profileTab: "프로필",
  },
  homeScreen: {
    title: "홈",
    placeholder: "대시보드 콘텐츠 곧 제공 예정",
  },
  meetingsScreen: {
    title: "미팅",
    placeholder: "미팅 목록 곧 제공 예정",
  },
  scheduleScreen: {
    title: "일정",
    placeholder: "일정 보기 곧 제공 예정",
  },
  profileScreen: {
    title: "프로필",
    placeholder: "프로필 설정 곧 제공 예정",
  },
  devScreen: {
    title: "개발자 도구",
    reportBugs: "버그 신고",
    reactotron: "Reactotron으로 보내기",
    androidReactotronHint: "작동하지 않으면 Reactotron이 실행 중인지 확인하세요.",
    iosReactotronHint: "작동하지 않으면 Reactotron이 실행 중인지 확인하세요.",
    macosReactotronHint: "작동하지 않으면 Reactotron이 실행 중인지 확인하세요.",
    webReactotronHint: "작동하지 않으면 Reactotron이 실행 중인지 확인하세요.",
    windowsReactotronHint: "작동하지 않으면 Reactotron이 실행 중인지 확인하세요.",
  },
}

export default ko
