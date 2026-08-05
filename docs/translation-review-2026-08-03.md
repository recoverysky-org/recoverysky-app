# Translation review queue — In-Person UI branch (2026-08-03)

**325 machine-assisted strings awaiting a native-speaker pass before release.**

Standing ruling (Jenova, 2026-08-03): implementers write best-effort
translations in all nine locales now, and every string gets listed here for
review before the release ships. `en` and `es` were authored in the plan and
are **not** in this queue — they need no review.

The seven locales needing review: **ar, de, fr, pt, ru, th, uk**.

The three 2026-08-04 batches (`shortTime`, `fellowship`, Search filters) add
an eighth: **es**.
The original `es` strings were authored in the plan and are exempt, but these
were written by an implementer like every other locale, so they carry the same
review obligation.

| Namespace | Keys | Locales | Strings | Authored in |
|---|---|---|---|---|
| `inPersonPopup` | 10 | 7 | 70 | Task 9 |
| `inPersonScreen` | 9 | 7 | 63 | Task 10 |
| `inPersonScreen` (shortTime) | 8 | 8 | 64 | shortTime filter, 2026-08-04 |
| `inPersonScreen` (fellowship) | 3 | 8 | 24 | fellowship filter, 2026-08-04 |
| `listingsScreen` (venue/radius/time) | 7 | 8 | 56 | Search filters, 2026-08-04 |
| location-failure copy (both namespaces) | 5 | 8 | 40 | Android location fix, 2026-08-04 |
| `liveScreen` (retitle) | 1 | 8 | 8 | Live Online retitle, 2026-08-04 |
| **Total** | | | **325** | |

Structural integrity is already machine-verified for both namespaces: key
sets are identical across all nine locales with no extras, and every
`{{distance}}` / `{{day}}` / `{{fellowship}}` interpolation placeholder is
present and correctly named. **What needs a human is semantics and register**,
not correctness.

Copied from `.superpowers/sdd/2026-08-03-in-person-ui/translation-review-queue.md`
(git-ignored scratch, does not survive) so this list has a durable home. See
`TODO.md` and `docs/PRODUCTION_CHECKLIST.md` for the release-blocker tracking.

## Reviewer notes worth acting on first

- **Arabic + RTL bidi.** `withinRadius` and `emptyNearby` embed `{{distance}}`
  inside RTL text, and the injected value carries Latin numerals ("5 mi").
  The placeholder is structurally correct, but bidi rendering around it needs
  eyes **on device**, not in a text editor.
- **Day rendered as a parenthetical in ar/ru/uk** — `({{day}})` rather than an
  inline "on {{day}}". Grammatical, but check it reads naturally rather than
  clinically. de/fr/pt/th preserve the inline preposition.
- **`{{fellowship}}` interpolates a raw code** like "AA"/"NA", not a
  translated name. German's `"{{fellowship}}-Präsenz-Meetings"` hyphenation
  and Thai's classifier placement both want a native check.
- **Register.** These are strings for people looking for recovery meetings.
  Machine translation reliably gets the words right and the warmth wrong —
  the `locationBanner` and `selectFellowship` strings are the ones most worth
  reading aloud.

---

## `inPersonScreen` — 63 strings (7 locales × 9 keys)

> **Stale entries below, by design.** This section records what Task 10
> authored. Two of these keys were re-translated on 2026-08-04 and the strings
> shown here are no longer what ships: `selectRadius` (twice — see both
> addenda) and `selectFellowship`. Review the addendum versions, not these.
> The rest of the section is still current.

### ar (Arabic)
- title: "حضوريًا"
- withinRadius: "ضمن {{distance}}"
- selectRadius: "مسافة البحث"
- locationBanner: "فعّل الموقع لرؤية الاجتماعات القريبة منك"
- locationBannerDenied: "الموقع معطّل — افتح الإعدادات لتفعيل النتائج القريبة"
- nearbyFailedBanner: "تعذّر تحميل النتائج القريبة — اضغط لإعادة المحاولة"
- emptyNearby: "لا توجد اجتماعات حضورية ضمن {{distance}} ({{day}}) — جرّب نطاقًا أوسع"
- emptyFallback: "لا توجد اجتماعات {{fellowship}} حضورية ({{day}})"
- selectFellowship: "اختر زمالة في الإعدادات لرؤية الاجتماعات"

### de (German)
- title: "Vor Ort"
- withinRadius: "Im Umkreis von {{distance}}"
- selectRadius: "Suchradius"
- locationBanner: "Aktiviere den Standort, um Meetings in deiner Nähe zu sehen"
- locationBannerDenied: "Standort ist aus — öffne die Einstellungen für Ergebnisse in der Nähe"
- nearbyFailedBanner: "Ergebnisse in der Nähe konnten nicht geladen werden — zum Wiederholen tippen"
- emptyNearby: "Keine Präsenz-Meetings im Umkreis von {{distance}} am {{day}} — versuche einen größeren Radius"
- emptyFallback: "Keine {{fellowship}}-Präsenz-Meetings am {{day}}"
- selectFellowship: "Wähle in den Einstellungen eine Gemeinschaft, um Meetings zu sehen"

### fr (French)
- title: "En personne"
- withinRadius: "Dans un rayon de {{distance}}"
- selectRadius: "Distance de recherche"
- locationBanner: "Activez la localisation pour voir les réunions près de chez vous"
- locationBannerDenied: "La localisation est désactivée — ouvrez les Réglages pour activer les résultats à proximité"
- nearbyFailedBanner: "Impossible de charger les résultats à proximité — touchez pour réessayer"
- emptyNearby: "Aucune réunion en présentiel dans un rayon de {{distance}} le {{day}} — essayez un rayon plus large"
- emptyFallback: "Aucune réunion {{fellowship}} en présentiel le {{day}}"
- selectFellowship: "Sélectionnez une fraternité dans les Réglages pour voir les réunions"

### pt (Portuguese)
- title: "Presencial"
- withinRadius: "Em um raio de {{distance}}"
- selectRadius: "Distância de busca"
- locationBanner: "Ative a localização para ver reuniões perto de você"
- locationBannerDenied: "A localização está desativada — abra os Ajustes para ver resultados próximos"
- nearbyFailedBanner: "Não foi possível carregar os resultados próximos — toque para tentar novamente"
- emptyNearby: "Nenhuma reunião presencial em um raio de {{distance}} em {{day}} — tente um raio maior"
- emptyFallback: "Nenhuma reunião presencial de {{fellowship}} em {{day}}"
- selectFellowship: "Selecione uma irmandade nos Ajustes para ver reuniões"

### ru (Russian)
- title: "Очно"
- withinRadius: "В радиусе {{distance}}"
- selectRadius: "Радиус поиска"
- locationBanner: "Включите геолокацию, чтобы видеть встречи рядом с вами"
- locationBannerDenied: "Геолокация выключена — откройте Настройки, чтобы включить поиск поблизости"
- nearbyFailedBanner: "Не удалось загрузить результаты поблизости — нажмите, чтобы повторить"
- emptyNearby: "Нет очных встреч в радиусе {{distance}} ({{day}}) — попробуйте больший радиус"
- emptyFallback: "Нет очных встреч {{fellowship}} ({{day}})"
- selectFellowship: "Выберите содружество в Настройках, чтобы увидеть встречи"

### th (Thai)
- title: "แบบพบหน้า"
- withinRadius: "ภายใน {{distance}}"
- selectRadius: "ระยะการค้นหา"
- locationBanner: "เปิดตำแหน่งที่ตั้งเพื่อดูการประชุมใกล้คุณ"
- locationBannerDenied: "ตำแหน่งที่ตั้งปิดอยู่ — เปิดการตั้งค่าเพื่อดูผลลัพธ์ใกล้เคียง"
- nearbyFailedBanner: "โหลดผลลัพธ์ใกล้เคียงไม่สำเร็จ — แตะเพื่อลองใหม่"
- emptyNearby: "ไม่มีการประชุมแบบพบหน้าภายใน {{distance}} ใน {{day}} — ลองขยายระยะการค้นหา"
- emptyFallback: "ไม่มีการประชุม {{fellowship}} แบบพบหน้าใน {{day}}"
- selectFellowship: "เลือกกลุ่มมิตรภาพในการตั้งค่าเพื่อดูการประชุม"

### uk (Ukrainian)
- title: "Особисто"
- withinRadius: "У радіусі {{distance}}"
- selectRadius: "Радіус пошуку"
- locationBanner: "Увімкніть геолокацію, щоб бачити зустрічі поруч із вами"
- locationBannerDenied: "Геолокацію вимкнено — відкрийте Налаштування, щоб увімкнути пошук поблизу"
- nearbyFailedBanner: "Не вдалося завантажити результати поблизу — торкніться, щоб повторити"
- emptyNearby: "Немає очних зустрічей у радіусі {{distance}} ({{day}}) — спробуйте більший радіус"
- emptyFallback: "Немає очних зустрічей {{fellowship}} ({{day}})"
- selectFellowship: "Виберіть спільноту в Налаштуваннях, щоб побачити зустрічі"

---

## `inPersonPopup` — 70 strings (7 locales × 10 keys)

Keys: `getDirections`, `contacts`, `imHere`, `imHereSaving`, `logged`,
`alsoOnline`, `approximate`, `attendanceSaved`, `attendanceError`,
`tapTimesHint`.

### Arabic (`ar.ts`)
| Key | String |
|---|---|
| getDirections | الحصول على الاتجاهات |
| contacts | جهات الاتصال |
| imHere | أنا هنا |
| imHereSaving | جارٍ الحفظ… |
| logged | تم تسجيل الحضور |
| alsoOnline | يجتمع أيضًا عبر الإنترنت |
| approximate | الموقع الظاهر تقريبي |
| attendanceSaved | تم حفظ الحضور |
| attendanceError | تعذر حفظ الحضور — يرجى المحاولة مرة أخرى |
| tapTimesHint | اضغط على وقت لتعيين تذكير |

### German (`de.ts`)
| Key | String |
|---|---|
| getDirections | Route anzeigen |
| contacts | Kontakte |
| imHere | Ich bin hier |
| imHereSaving | Wird gespeichert… |
| logged | Anwesenheit erfasst |
| alsoOnline | Trifft sich auch online |
| approximate | Der angezeigte Standort ist ungefähr |
| attendanceSaved | Anwesenheit gespeichert |
| attendanceError | Anwesenheit konnte nicht gespeichert werden — bitte erneut versuchen |
| tapTimesHint | Tippe auf eine Uhrzeit, um eine Erinnerung festzulegen |

### French (`fr.ts`)
| Key | String |
|---|---|
| getDirections | Itinéraire |
| contacts | Contacts |
| imHere | Je suis ici |
| imHereSaving | Enregistrement… |
| logged | Présence enregistrée |
| alsoOnline | Se réunit aussi en ligne |
| approximate | L'emplacement affiché est approximatif |
| attendanceSaved | Présence enregistrée |
| attendanceError | Impossible d'enregistrer la présence — veuillez réessayer |
| tapTimesHint | Touchez une heure pour définir un rappel |

### Portuguese (`pt.ts`)
| Key | String |
|---|---|
| getDirections | Como chegar |
| contacts | Contatos |
| imHere | Estou aqui |
| imHereSaving | Salvando… |
| logged | Presença registrada |
| alsoOnline | Também se reúne on-line |
| approximate | O local exibido é aproximado |
| attendanceSaved | Presença salva |
| attendanceError | Não foi possível salvar a presença — tente novamente |
| tapTimesHint | Toque em um horário para definir um lembrete |

### Russian (`ru.ts`)
| Key | String |
|---|---|
| getDirections | Проложить маршрут |
| contacts | Контакты |
| imHere | Я здесь |
| imHereSaving | Сохранение… |
| logged | Посещение зафиксировано |
| alsoOnline | Также встречается онлайн |
| approximate | Указанное местоположение приблизительное |
| attendanceSaved | Посещение сохранено |
| attendanceError | Не удалось сохранить посещение — попробуйте ещё раз |
| tapTimesHint | Нажмите на время, чтобы установить напоминание |

### Thai (`th.ts`)
| Key | String |
|---|---|
| getDirections | ขอเส้นทาง |
| contacts | ผู้ติดต่อ |
| imHere | ฉันอยู่ที่นี่ |
| imHereSaving | กำลังบันทึก… |
| logged | บันทึกการเข้าร่วมแล้ว |
| alsoOnline | จัดประชุมออนไลน์ด้วย |
| approximate | ตำแหน่งที่แสดงเป็นตำแหน่งโดยประมาณ |
| attendanceSaved | บันทึกการเข้าร่วมแล้ว |
| attendanceError | ไม่สามารถบันทึกการเข้าร่วมได้ — โปรดลองอีกครั้ง |
| tapTimesHint | แตะเวลาเพื่อตั้งการแจ้งเตือน |

### Ukrainian (`uk.ts`)
| Key | String |
|---|---|
| getDirections | Прокласти маршрут |
| contacts | Контакти |
| imHere | Я тут |
| imHereSaving | Збереження… |
| logged | Відвідування зафіксовано |
| alsoOnline | Також зустрічається онлайн |
| approximate | Показане місцезнаходження приблизне |
| attendanceSaved | Відвідування збережено |
| attendanceError | Не вдалося зберегти відвідування — спробуйте ще раз |
| tapTimesHint | Торкніться часу, щоб встановити нагадування |


---

# Addendum — In-Person `shortTime` filter (2026-08-04)

Eight keys across **eight** locales (es + the original seven) = **64 strings**.
Seven keys are new; `selectRadius` is a re-translation.

| Key | English | Notes |
|---|---|---|
| `shortTimeLabel` | Time | Row label AND modal title. Must stay short — it shares a row with a chevron. |
| `shortTimeAll` | Any time | The default. Must read as "no filter applied", not as a bucket. |
| `shortTimeMorning` | Morning | Bucket 05:00–11:59 |
| `shortTimeAfternoon` | Afternoon | Bucket 12:00–16:59 |
| `shortTimeEvening` | Evening | Bucket 17:00–21:59 |
| `shortTimeOvernight` | Overnight | Bucket 22:00–04:59, **wraps midnight** |
| `emptyShortTime` | No {{day}} meetings match {{time}}. Tap to pick another time. | `{{time}}` interpolates one of the five bucket labels above |
| `selectRadius` | Distance | **Changed** 2026-08-04 from "Search Distance" at Jenova's request. Every locale was shortened to match. |

## Reviewer notes worth acting on first

- **The four buckets must partition the day, in the reader's head as well as in
  code.** The boundaries are fixed in `app/utils/filterLogic.ts` and are not
  translatable; the labels have to make a user predict the right one. Where a
  language's everyday time words don't split 4 ways at 05/12/17/22, say so —
  the fix may be to show the hour range in the picker rather than to force a
  word.
- **Spanish/Portuguese `tarde` covers both afternoon and evening.** Currently
  `afternoon → Tarde`, `evening → Noche`/`Noite`, `overnight → Madrugada`.
  That is the conventional split, but a native speaker should confirm `Noche`
  reading as 17:00–21:59 rather than "night".
- **Russian/Ukrainian `День` for afternoon** literally means "day". Idiomatic
  for the 12–17 window, but check it doesn't read as "all day" beside
  `Любое время` / `Будь-який час` in the same picker.
- **German `Nachts` for overnight vs `Abends` for evening** — verify the pair
  reads as adjacent spans and not as a synonym collision.
- **Thai `emptyShortTime` omits spaces around the placeholders**
  (`วัน{{day}}ที่ตรงกับ{{time}}`) per Thai orthography. Confirm on device — the
  interpolated values are themselves Thai here, so this should render clean,
  unlike the Latin-numeral distance case flagged above.
- **`{{time}}` is interpolated mid-sentence**, so bucket labels are capitalized
  in English ("No Tuesday meetings match Evening."). Locales where a mid-sentence
  capital is wrong should either lowercase the bucket labels or restructure
  `emptyShortTime` around them.

---

# Addendum — In-Person Fellowship filter + 2×2 grid (2026-08-04)

Three keys across **eight** locales (es + the original seven) = **24 strings**.
One key is new; two are re-translations of strings this branch already shipped.

| Key | English | Notes |
|---|---|---|
| `fellowshipLabel` | Fellowship | **New.** Compact label for a half-width grid cell. Must be short — see the layout note below. |
| `selectRadius` | Radius | **Changed** 2026-08-04, second time this branch: "Search Distance" → "Distance" → "Radius". The visible value beside it is now a bare distance ("25 mi"), not "Within 25 mi". |
| `selectFellowship` | Tap to pick a fellowship and see in-person meetings | **Changed.** Used to send the user to Settings; the segment now has its own picker, and the message itself is the tap target. |

## Reviewer notes worth acting on first

- **`fellowshipLabel` shares a ~160dp cell with its value and a chevron.** Long
  translations (de `Gemeinschaft`, ru `Сообщество`, uk `Спільнота`,
  pt `Irmandade`, fr `Fraternité`) will wrap to two lines on a 360dp-wide
  phone. That is handled — the row stretches and both cells stay level — but
  if your language has a shorter everyday word for the same concept, prefer it.
  Do not sacrifice the established domain term just to save a line.
- **Term consistency is deliberate here.** `fellowshipLabel` was matched to the
  word each locale already uses in `settingsScreen:selectFellowship`, because
  that string is the title of the very modal this label opens. If the two
  disagree in your locale, they should be fixed together, not separately.
  Note `es` already carries two words for this — `grupo` in the settings
  picker, `confraternidad` in the in-person empty state. The new label follows
  `grupo` (the modal it opens); whether the whole `es` set should converge on
  one term is a reviewer call.
- **`selectFellowship` is now an instruction to tap, not a pointer elsewhere.**
  The copy has to read as an action on *this* screen. A locale that renders it
  as a passive description ("A fellowship has not been selected") loses the
  affordance — the text is the button.
- **`selectRadius` must not re-lengthen.** It is a label column beside a value
  column; the previous wording overflowed and truncated to `RadiusWith…`,
  hiding the value entirely. Prefer the shortest accurate word. Flagged for
  `ar` in particular: `النطاق` was chosen over the literal geometric
  `نصف القطر`, which is both long and wrong in register for a search radius —
  confirm it reads naturally.

---

# Addendum — Search segment filters (2026-08-04)

Seven keys across **eight** locales (es + the original seven) = **56 strings**.
Six are new; `langLabel` is a shortened re-translation of an existing string.

> **`venueAll` ("All") was deleted on 2026-08-04**, before any review happened —
> Search dropped the "All" venue choice entirely. It was listed here in the
> original eight; do not translate it, and drop it from any in-flight review
> file. That is where the count went from 64 to 56.

| Key | English | Notes |
|---|---|---|
| `langLabel` | Lang | **New, but replaces `languageLabel` on screen.** `languageLabel` ("Language") still exists and is still used for the picker's own title — this is the compact grid-cell version. Only shorten if your language genuinely has a shorter form; a "shortening" that isn't a real word is worse than the long one. |
| `venueLabel` | Venue | Grid-cell label AND modal title. |
| `venueOnline` | Online | |
| `venueInPerson` | In-Person | Should match `inPersonScreen:title` in your locale — same concept, two places. Check them side by side. |
| `timeCustom` | Custom | The Time option that reveals the Start/End hour pickers. "Custom range" if your language needs the noun. |
| `radiusNoLocation` | Turn on location to search by distance | Shown under the radius picker's title, and read after the label on the dimmed radius cell, while the app has no position. It must read as an *instruction that will fix the problem*, not as an error report — tapping a distance is what triggers the permission prompt. **Replaced `radiusAny` ("Any")** on 2026-08-04 when the "Any" radius option was removed. |
| `radiusOnlineNote` | not available for online meetings | **Screen-reader only** — never rendered visually. Read as the value of a disabled Radius control, i.e. "Radius, not available for online meetings". Lowercase and fragmentary on purpose. |

## Reviewer notes worth acting on first

- **These labels live in half-width grid cells (~160dp).** Long translations
  wrap to two lines rather than truncating, which is handled but not free.
  `venueLabel` and `langLabel` are the two most at risk. Prefer the shortest
  word that's still the *right* word.
- **`radiusNoLocation` is the only string here that asks for something.** The
  rest label controls; this one has to move a user to act. Machine translation
  reliably renders it as a flat statement of fact ("location is off"), which
  loses the point — read it aloud and check it sounds like a next step.
- **Venue vocabulary must agree with the segment names.** `venueInPerson` and
  the In-Person segment title are the same concept in the same tab; so are
  `venueOnline` and how Live describes its meetings. A locale that translates
  them differently makes the Venue filter look like it's filtering something
  else. Flagged specifically for `ru`/`uk`/`th`, where the label was rendered
  as "format" (Формат / รูปแบบ) rather than a literal "venue" — that reads
  better for a two-option online/in-person split, but confirm it.
- **`radiusOnlineNote` is a fragment, by design.** It is concatenated after the
  label by the accessibility layer, never shown as a sentence. If your language
  can't produce a natural fragment there, rewrite it as a full clause that
  still reads correctly *after* the word for "Radius".

---

## Location-failure copy — 40 strings (8 locales × 5 keys), 2026-08-04

Added with the Android location fix. Five keys across two namespaces, all of
them shown when the app cannot narrow a search to where the user is.

| Key | English | Notes for the reviewer |
|---|---|---|
| `inPersonScreen:locationFixFailedBanner` | Couldn't get your location — tap to retry | **The whole point of this batch.** It is shown to a user whose location permission is GRANTED and whose GPS fix simply didn't land. It must not read as "location is off" or "enable location" — that is `locationBanner`, a different string for a different person. This one says the app tried and failed, and that tapping tries again. |
| `inPersonScreen:emptyNoLocation` | Turn on location to find in-person meetings near you | The empty list body when location is off. An instruction that will fix the problem, like `radiusNoLocation` — not a statement of fact. |
| `inPersonScreen:emptyFixFailed` | We couldn't get your location — tap to try again | Empty-list twin of `locationFixFailedBanner`. Fine to share wording with it in your language; they appear one above the other, so identical phrasing reads as repetition — prefer a shorter form here if that's awkward. |
| `listingsScreen:radiusOff` | Location off | Replaces the distance in the Search tab's Radius cell when we hold no position. **A half-width grid cell (~160dp) at value-text size — keep it to two short words.** It is the only visible sign that in-person results are missing from the search entirely, so it must not read as a mere styling state. |
| `listingsScreen:emptyNoLocation` | Turn on location to search for in-person meetings near you | Same instruction as the In-Person one, phrased for a *search*. Keep the two consistent in your locale; a user hitting both should not think they are about different features. |

### Reviewer notes worth acting on first

- **"Denied" vs "failed" is the distinction this batch exists to make.** Before
  2026-08-04 both cases shared `locationBanner` ("Enable location…"), which told
  users to switch on something already switched on. If your language collapses
  the two — or if the retry phrasing implies a settings trip — the bug is back
  in that locale. Read `locationBanner`, `locationBannerDenied`, and
  `locationFixFailedBanner` side by side; they must be three clearly different
  messages.
- **Every one of these strings is on a tappable surface.** Banner and empty
  state both act when tapped. Copy that reads as an apology with no next step
  loses that affordance for anyone who doesn't try tapping.
- **`radiusOff` shares a cell with real distances** ("16 mi", "25 km"). It has
  to look like a *state* where a value should be, not like a truncated value.

---

## `liveScreen` retitle — 8 strings (8 locales × 1 key), 2026-08-04

`liveScreen:title` changed from "Live Meetings" to **"Live Online"**. Not a new
key — a re-translation of one that already shipped, so the existing value in
your locale is what a user has been reading until now.

| Key | English | Notes |
|---|---|---|
| `liveScreen:title` | Live Online | The heading over the Live segment, which lists **online meetings that are streaming right now**. Both halves carry weight: *live* = happening at this moment, *online* = not a physical venue. The old title said only the first half, which stopped being enough once the In-Person segment appeared beside it — "Live Meetings" now reads as "live meetings of any kind", including ones you'd drive to. |

### Reviewer notes worth acting on first

- **Check this against the segment labels in the same tab.** The three segments
  are Live / In-Person / Search (`meetingsScreen:liveSegment` etc.). This
  heading sits directly under them, so the word you choose for "online" should
  be the same one `listingsScreen:venueOnline` uses. Three words for one concept
  in one tab is the failure mode here.
- **`ru`, `uk`, `th` need the closest look.** Their previous titles were already
  built around "online" (Собрания онлайн / Зустрічі онлайн / ประชุมสด) rather
  than "live", so the machine-assisted rewrite ("Сейчас онлайн" / "Зараз
  онлайн" / "สดออนไลน์") is doing more than adding a word — confirm it still
  names the right thing and doesn't just read as a status.
- **`de` and `en` are now identical** ("Live Online"). That is plausible for
  German, where both words are in common use, but confirm it isn't lazier than
  a native heading would be.
