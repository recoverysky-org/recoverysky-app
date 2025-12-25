import { Translations } from "./en"

const fr: Translations = {
  common: {
    ok: "OK",
    cancel: "Annuler",
    back: "Retour",
    logOut: "Déconnexion",
  },
  welcomeScreen: {
    postscript: "Ce n'est probablement pas à quoi ressemble votre app.",
    readyForLaunch: "Votre app, presque prête à lancer!",
    exciting: "(ohh, c'est excitant!)",
    letsGo: "Allons-y!",
  },
  errorScreen: {
    title: "Quelque chose s'est mal passé!",
    friendlySubtitle: "C'est l'écran que vos utilisateurs verront en production lorsqu'une erreur survient.",
    reset: "RÉINITIALISER L'APP",
    traceTitle: "Erreur de la pile %{name}",
  },
  emptyStateComponent: {
    generic: {
      heading: "Si vide... si triste",
      content: "Pas encore de données. Essayez d'appuyer sur le bouton pour rafraîchir.",
      button: "Réessayons",
    },
  },
  errors: {
    invalidEmail: "Adresse email invalide.",
  },
  loginScreen: {
    logIn: "Se connecter",
    enterDetails: "Entrez vos détails ci-dessous pour débloquer des informations secrètes.",
    emailFieldLabel: "Email",
    passwordFieldLabel: "Mot de passe",
    emailFieldPlaceholder: "Entrez votre adresse email",
    passwordFieldPlaceholder: "Mot de passe super secret ici",
    tapToLogIn: "Appuyez pour vous connecter!",
    hint: "Astuce: vous pouvez utiliser n'importe quel email et votre mot de passe préféré :)",
  },
  mainNavigator: {
    homeTab: "Accueil",
    meetingsTab: "Réunions",
    scheduleTab: "Horaire",
    profileTab: "Profil",
  },
  homeScreen: {
    title: "Accueil",
    placeholder: "Contenu du tableau de bord bientôt disponible",
  },
  meetingsScreen: {
    title: "Réunions",
    placeholder: "Liste des réunions bientôt disponible",
  },
  scheduleScreen: {
    title: "Horaire",
    placeholder: "Vue de l'horaire bientôt disponible",
  },
  profileScreen: {
    title: "Profil",
    placeholder: "Paramètres du profil bientôt disponible",
  },
  devScreen: {
    title: "Outils de développement",
    reportBugs: "Signaler des bugs",
    reactotron: "Envoyer à Reactotron",
    androidReactotronHint: "Si cela ne fonctionne pas, assurez-vous que Reactotron est en cours d'exécution.",
    iosReactotronHint: "Si cela ne fonctionne pas, assurez-vous que Reactotron est en cours d'exécution.",
    macosReactotronHint: "Si cela ne fonctionne pas, assurez-vous que Reactotron est en cours d'exécution.",
    webReactotronHint: "Si cela ne fonctionne pas, assurez-vous que Reactotron est en cours d'exécution.",
    windowsReactotronHint: "Si cela ne fonctionne pas, assurez-vous que Reactotron est en cours d'exécution.",
  },
}

export default fr
