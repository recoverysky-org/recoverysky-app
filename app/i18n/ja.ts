import { Translations } from "./en"

const ja: Translations = {
  common: {
    ok: "OK",
    cancel: "キャンセル",
    back: "戻る",
    logOut: "ログアウト",
  },
  welcomeScreen: {
    postscript: "おそらくこれはあなたのアプリの見た目ではないでしょう。",
    readyForLaunch: "あなたのアプリ、もうすぐ起動準備完了！",
    exciting: "(おお、これはワクワクする！)",
    letsGo: "行きましょう！",
  },
  errorScreen: {
    title: "何かがうまくいきませんでした！",
    friendlySubtitle: "これはエラーが発生した際にユーザーが本番環境で見る画面です。",
    reset: "アプリをリセット",
    traceTitle: "%{name}スタックからのエラー",
  },
  emptyStateComponent: {
    generic: {
      heading: "とても空っぽ...悲しい",
      content: "まだデータがありません。ボタンを押してリフレッシュしてください。",
      button: "もう一度試しましょう",
    },
  },
  errors: {
    invalidEmail: "無効なメールアドレスです。",
  },
  loginScreen: {
    logIn: "ログイン",
    enterDetails: "極秘情報をアンロックするには、下に詳細を入力してください。",
    emailFieldLabel: "メール",
    passwordFieldLabel: "パスワード",
    emailFieldPlaceholder: "メールアドレスを入力",
    passwordFieldPlaceholder: "超秘密のパスワードをここに",
    tapToLogIn: "タップしてログイン！",
    hint: "ヒント：任意のメールと好きなパスワードを使用できます :)",
  },
  mainNavigator: {
    homeTab: "ホーム",
    meetingsTab: "ミーティング",
    scheduleTab: "スケジュール",
    profileTab: "プロフィール",
  },
  homeScreen: {
    title: "ホーム",
    placeholder: "ダッシュボードコンテンツは近日公開",
  },
  meetingsScreen: {
    title: "ミーティング",
    placeholder: "ミーティングリストは近日公開",
  },
  scheduleScreen: {
    title: "スケジュール",
    placeholder: "スケジュールビューは近日公開",
  },
  profileScreen: {
    title: "プロフィール",
    placeholder: "プロフィール設定は近日公開",
  },
  devScreen: {
    title: "開発者ツール",
    reportBugs: "バグを報告",
    reactotron: "Reactotronに送信",
    androidReactotronHint: "動作しない場合は、Reactotronが実行中であることを確認してください。",
    iosReactotronHint: "動作しない場合は、Reactotronが実行中であることを確認してください。",
    macosReactotronHint: "動作しない場合は、Reactotronが実行中であることを確認してください。",
    webReactotronHint: "動作しない場合は、Reactotronが実行中であることを確認してください。",
    windowsReactotronHint: "動作しない場合は、Reactotronが実行中であることを確認してください。",
  },
}

export default ja
