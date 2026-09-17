# Translation review queue — In-Person UI branch (2026-08-03)

**421 machine-assisted strings awaiting a native-speaker pass before release.**

> **WAIVED FOR 4.8.0 (Jenova, 2026-08-09).** This queue is a release blocker
> per `TODO.md` and `docs/PRODUCTION_CHECKLIST.md`; for the 4.8.0 native
> release it was explicitly waived rather than cleared. 4.8.0 ships all 421
> strings as machine-assisted text. `en` and `es` are human-authored in the
> plan and unaffected.
>
> The waiver covers **4.8.0 only** — it does not clear the queue and does not
> carry to later releases. The table below is still outstanding work.
>
> Correcting these later needs **no native build**: locale files are JS, so a
> reviewed batch ships as an OTA (`npm run update`) on top of 4.8.0. That is
> what made waiving cheap, and it is the reason not to let the queue drift —
> the fix path stays open the whole time.

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
| `listingsScreen` (search box: `searchPlaceholder` / `clearSearch` / `emptyNoMatches`) | 3 | 8 | 24 | Free-text search, 2026-09-05 |
| `presence` + `inPersonTimer` | 12 | 8 | 96 | GPS in-person attendance, Task 7, 2026-08-05 |
| `inPersonScreen` (list/map pill + count) | 4 | 8 | 32 | List/map pill redesign, 2026-08-12 |
| **Total** | | | **477** | |

The 2026-08-12 batch is `viewList` / `viewMap` / `resultCount_one` /
`resultCount_other`. Two specific things for a reviewer to check, beyond the
usual register question:

- **`viewList` / `viewMap` must be short.** They render inside a two-part pill
  in the segment header, next to a 15px icon, with the heading competing for
  the same row. A noun of roughly "List"/"Map" length fits; a descriptive
  phrase will truncate. If your language has no short noun for either, say so
  rather than picking a long one — the layout can change, the truncation
  can't be styled around.
- **`resultCount` has only two plural forms.** `Translations = typeof en`
  forbids a locale from carrying keys English lacks, so ru/uk/ar cannot add
  their own `_few` / `_many` forms and `_other` has to cover every non-singular
  count. Pick the form that reads least wrong across the range — this is a
  pre-existing constraint on every plural in the file, not new here, but the
  Slavic and Arabic reviewers should know it is deliberate and not a gap they
  can fill.

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

---

## `presence` + `inPersonTimer` — 96 strings (8 locales × 12 keys), 2026-08-05

New namespaces for the GPS-verified in-person attendance feature (Task 7 of
the `feat/gps-in-person-attendance` plan). `presence` covers the out-of-range
alert, permission-denied messaging, and location-fix-failure copy shown when
a user taps "I'm Here"; `inPersonTimer` is the timer modal's title and
credit-floor hint (Tasks 9/10 consume both). Unlike the `en`/`es` split noted
at the top of this doc, **`es` here is implementer-authored, not
plan-authored** — it carries the same review obligation as the other seven.

| Key | English | Notes for the reviewer |
|---|---|---|
| `presence:outOfRangeTitle` | You're not there yet | Alert title shown when a GPS check fails distance. |
| `presence:outOfRangeMessage` | You're about {{distance}} from this meeting. Get within {{radius}} to record your attendance. | **Both `{{distance}}` and `{{radius}}` arrive pre-formatted** ("3 mi" / "250 m") by `formatDistance()` — never append a unit. This is the one string in the whole app where a live distance reaches the user's screen; it must never reach a log (see `CLAUDE.md`). |
| `presence:noVenueCoordsTitle` | Can't verify this location | Shown instead of the distance alert when the meeting record itself has no coordinates to check against — a data problem, not a location problem. Keep it distinct from `outOfRangeTitle`/`deniedTitle` in your locale; conflating them tells the user to fix something (their location, their permission) that isn't the actual cause. |
| `presence:noVenueCoordsMessage` | We don't have a precise location for this meeting, so we can't confirm you're here. | Companion to the above — explains the meeting is at fault, not the user's device. |
| `presence:deniedTitle` | Location needed | Shown when OS location permission is denied/restricted. |
| `presence:deniedMessage` | Recording in-person attendance needs your location to confirm you're at the meeting. | Paired with `openSettings` as the action button — should read as an explanation for why the app is about to ask, not a scold. |
| `presence:openSettings` | Open Settings | Button label that deep-links to the OS settings app. Short, imperative — match the register your locale already uses for `common` button labels rather than inventing new phrasing. |
| `presence:fixFailedTitle` | Couldn't find you | Shown when permission is granted but the GPS fix itself failed (weak signal, indoors, etc.) — the closest analogue is `locationFixFailedBanner` from the 2026-08-04 batch above; keep the "we tried and it didn't land" tone consistent with that string in your locale. |
| `presence:fixFailedMessage` | We couldn't get your location. Step outside or try again in a moment. | Actionable retry copy — "step outside" is the one concrete suggestion; don't lose it to a vaguer "try again". |
| `presence:checking` | Checking… | Transient in-progress label, likely on a spinner or disabled button. Keep it short — this is not the place for a full sentence. |
| `inPersonTimer:title` | Attendance Timer | Deliberately the same English string as `externalZoomTimer:title` (this modal is the in-person sibling of the external-Zoom timer). **Reused the existing translation verbatim in every locale** rather than re-translating, to keep the two timer modals terminologically identical — confirm that read is still right for your language rather than assuming it's a placeholder. |
| `inPersonTimer:hint` | End the timer when your meeting finishes. Save requires at least {{minutes}} min. | `{{minutes}}` must stay literal. `externalZoomTimer:hint` already solved this phrasing in every locale ("Return here when your meeting ends…"); this is a reworded variant ("End the timer…") since there's no separate app to return from in the in-person flow — check the reworded half reads naturally, not just the copied `{{minutes}}` clause. |

### Reviewer notes worth acting on first

- **`presence:outOfRangeMessage` is the highest-scrutiny string in this batch.**
  It's the only place a real GPS distance is ever shown to a user, it fires
  every time someone taps "I'm Here" too far from the venue, and it carries
  two interpolations back to back (`{{distance}}` then `{{radius}}`) — a
  transposed or reworded token here silently breaks the sentence. Verify token
  order reads naturally in each language, not just that both tokens are present.
- **Least confident, by locale** (where I'd start a review):
  - `ar` — `presence:outOfRangeTitle` ("لست هناك بعد"). Literal "not there yet"
    idiom translated fairly directly; a native speaker may have a more natural
    fixed phrase for "you haven't arrived."
  - `de` — `presence:fixFailedMessage` ("Geh nach draußen…"). "Step outside" as
    a literal command reads slightly blunt in German; a softer construction may
    fit better.
  - `fr` — `presence:noVenueCoordsMessage`. Long compound sentence translated
    clause-for-clause; worth checking it isn't running on longer than natural
    French phrasing would.
  - `pt` — `presence:outOfRangeMessage`. Brazilian vs. European Portuguese
    register wasn't distinguished; "Aproxime-se" reads natural for BR (matching
    the file's existing "você" register) but confirm that's the intended
    target audience.
  - `ru` — `presence:deniedMessage`. Formal "вы" is consistent with the file,
    but the sentence is dense (two clauses via "чтобы"); check it doesn't read
    as bureaucratic.
  - `th` — `presence:outOfRangeMessage`. Thai has no plural/singular
    distinction on the interpolated units, and no existing `{{radius}}`
    analogue in this file to pattern-match against (`inPersonScreen:selectRadius`
    is a label, not a sentence) — the clause order around both tokens is a
    first-principles translation, most worth a native check.
  - `uk` — `presence:fixFailedMessage`. Same "step outside" literalness
    concern as `de`; Ukrainian phrasing may prefer an indirect suggestion.
  - `es` — `presence:noVenueCoordsTitle` ("No podemos verificar esta
    ubicación"). Straightforward but this is the first `es` string in this
    doc's queue — flagging it because unlike the plan-authored `es` baseline,
    nothing here has had *any* prior review pass.

---

## `announcements` in-person popup — 24 strings (8 locales × 3 keys), 2026-08-13

The one-time announcement pointing existing users at the In-Person segment
(`app/config/announcements.ts`, id `in-person-meetings-2026-08`). Written by an
implementer in all nine locales, so `es` carries the same review obligation as
the other seven per the 2026-08-04 ruling above.

**This copy is unusually exposed:** it is a full-screen blocking modal that
every pre-4.8.0 user sees exactly once, with no way to re-read it. A clumsy
sentence here is the single impression a user forms of the feature.

| Key | English | Notes for the reviewer |
|---|---|---|
| `announcements:inPersonTitle` | In-Person Meetings Are Here | Modal heading at 17px/700. Short and announcement-flavoured — it must read as *new thing available*, not as a section label. Use the same term your locale already uses for `meetingsScreen:inPersonSegment` so the popup and the segment the button opens agree. |
| `announcements:inPersonBody` | The Meetings tab now has an In-Person segment. Find meetings near you as a list or on a map, get directions, and tap "I'm Here" when you arrive to log your attendance. You'll be asked for location the first time you open it. | Three sentences, and each is load-bearing: *where the feature is*, *what it does*, *the permission prompt is expected, not an error*. **Reuse the existing translations verbatim** for the tab (`meetingsTab`), the segment (`meetingsScreen:inPersonSegment`) and the button (`inPersonScreen:imHere`) — the quoted string in particular must match the button the user will actually tap. The third sentence exists because `locationEnabled` defaults OFF; don't drop it for brevity. |
| `announcements:inPersonCta` | Find a Meeting Near Me | Primary button, opens the In-Person segment directly. Imperative, matching the register your locale uses for `common` button labels. |

### Reviewer notes worth acting on first

- **All locales** — the quoted "I'm Here" inside the body was copied from each
  file's own `inPersonScreen:imHere`. Verify it still matches after any review
  pass on *that* key, or the popup will quote a button label that no longer
  exists on screen.
- **Quotation marks** — locale-appropriate marks were used rather than English
  ones (`«»` for es/ru/uk/ar, `„“` for de, `« »` for fr, `“”` for pt/th). Worth
  a glance that each matches house style in the rest of the file.
- `ar` — the body is the longest RTL string in the announcements namespace and
  wraps inside a fixed 85%-width card; check it reads well broken across lines,
  not just as a single sentence.
- `de` — "Beim ersten Öffnen wirst du nach dem Standort gefragt" is passive by
  design (the OS asks, not the app). Confirm that reads as neutral rather than
  evasive.
- `ru` / `uk` — formal register was matched to the existing file (`вы` / `Ви`),
  but the middle sentence chains three imperatives; check it doesn't read as a
  list of commands.
- `th` — no quotation-mark convention was inherited from this file for a
  *button label* being quoted mid-sentence; the `“”` choice is
  first-principles and most worth a native check.
- `es` — informal `tú` matches the existing `announcements` block. First `es`
  string in this doc since the 2026-08-05 batch.

---

## Profile deprecation — 16 strings (8 locales × 2 keys), 2026-08-13

Two strings changed when the profile concept left the UI (see `CHANGELOG.md`,
2026-08-13): the onboarding "Tell us about yourself" subtitle was **rewritten**
because its old text advertised display options that no longer exist, and a new
hint sits under Short Name in Settings → Attendance explaining why a name field
lives there. Written by an implementer in all nine locales, so `es` carries the
same review obligation as the other seven per the 2026-08-04 ruling above.

| Key | English | Notes for the reviewer |
|---|---|---|
| `onboarding:recoverySubtitle` | Used to filter meetings to your fellowship and to personalize your attendance records. | **Replaces existing text** — the old string promised "clean date/day display", which described the display-name toggles that are now hidden. Do not restore that clause; there is nothing behind it. The screen it subtitles now holds three fields (Short Name, Fellowship, Recovery Date), so the sentence covers filtering *and* personalization deliberately. Use the same fellowship term the file already uses for `onboarding:fellowship`. |
| `settingsScreen:shortNameHint` | Appears on your attendance reports and certificates. | Small dim text under the Short Name field in the Attendance section. Its job is to answer "why is a name field here?" in one glance — the two nouns are load-bearing and neither should be dropped for brevity. "Certificates" means the 90-in-90 certificate; match `ninetyInNinety` terminology in your locale rather than inventing a new word. |

### Reviewer notes worth acting on first

- **All locales** — the subtitle's fellowship noun was taken from each file's
  own `onboarding:fellowship`, which differs from `settingsScreen:recoveryFellowship`
  in several locales (`es` Grupo/Grupo de Recuperación, `de` Gemeinschaft/
  Genesungsgemeinschaft, `pt` Irmandade/Irmandade de Recuperação). The short
  form is intentional here; confirm it still reads naturally in a full sentence.
- `ar` — the subtitle is a single clause with two coordinated purposes; check
  the conjunction doesn't make it read as one action rather than two.
- `de` — informal `deine` matches the surrounding onboarding block; verify
  against the file's own register rather than the Settings block, which is
  mixed.
- `ru` / `uk` — "attendance records" was rendered as отчётах о посещении /
  звітах про відвідування, borrowing the *reports* noun. If your locale
  distinguishes a stored record from a sent report, the stored sense is meant.
- `th` — no article/plural marking, so "reports and certificates" reads as two
  bare nouns; check it doesn't collapse into a single compound.
- `es` — informal `tú` matches the existing onboarding and settings blocks.

---

## Short-name required dialog — 24 strings (8 locales × 3 keys), 2026-08-13

The dialog shown when a user sends an attendance report or generates a 90-in-90
certificate while Short Name is empty (`app/hooks/useShortNameGate.ts`). Written
by an implementer in all nine locales, so `es` carries the same review
obligation as the other seven per the 2026-08-04 ruling above.

**This copy blocks a paid feature.** It is the only thing standing between the
user and a report they are trying to send, so it has to explain *why* in one
read — a vague message here reads as the app refusing to work.

| Key | English | Notes for the reviewer |
|---|---|---|
| `settingsScreen:shortNameRequiredTitle` | Add Your Name First | Alert title. Imperative and specific — not "Missing information" or an error-flavoured phrase; nothing has gone wrong, there's just a step outstanding. |
| `settingsScreen:shortNameRequiredMessage` | Your short name is printed on attendance reports and certificates. Add one in Settings → Attendance, then try again. | Two sentences, both load-bearing: *why we're asking* and *exactly where to go*. **Reuse the existing translations verbatim** for the Settings tab (`mainNavigator:settingsTab`) and the section (`settingsScreen:attendanceSection`) — the path must name the two things the user will actually see on screen. The `→` arrow is used literally in all locales; RTL locales use `←` instead. |
| `settingsScreen:shortNameRequiredAction` | Go to Settings | Confirm button, navigates to Settings → Attendance. The other button is the shared `common:cancel`. Match the register your locale uses for other `common` button labels. |

### Reviewer notes worth acting on first

- **All locales** — the tab and section names in the message were checked
  against each file's own `mainNavigator:settingsTab` and
  `settingsScreen:attendanceSection` and corrected to match. **Five did not
  match on the first pass** (`es` Ajustes→Perfil, `de` Anwesenheit→Teilnahme,
  `pt` Configurações→Ajustes, `ru` Посещение→Посещения, `th`
  การตั้งค่า→ตั้งค่า). Re-verify after any review pass on *those* keys, or the
  dialog will name a screen the user can't find.
- **`es` — RESOLVED 2026-08-13 (Jenova), but leaves a loose end.**
  `mainNavigator:settingsTab` was "Perfil" where every other locale says some
  form of "Settings" — and with the Profile section hidden that tab was the
  last thing in the app still called "Profile". It is now **"Ajustes"**, which
  also matches the three strings in this file that already said Ajustes
  (`accessibility:doubleTapToOpenSettings`, the cloud-backup announcement,
  `inPersonScreen`'s location hint) and follows Apple's own Spanish convention
  for a short tab label.

  **The rest of the file was aligned the same day.** Eight strings that meant
  *our* Settings became Ajustes: `settingsScreen:title`,
  `settingsScreen:appSettingsSection`, `homeScreen:goToSettings`,
  `attendanceScreen:goToSettings`, `listingsScreen:selectFellowship`,
  `onboarding:enableAttendanceHint`, `loginScreen:enterDetailsAndroid`, and
  `accessibility:settings`.

  **Six were deliberately left as "Configuración"** and a reviewer should NOT
  sweep them up — they don't mean our screen:

  | Key | Why it stays |
  |---|---|
  | `settingsScreen:openSettings` | Opens the **device** settings; paired with `notificationsDisabledMessage`, which says "en la configuración de tu dispositivo". |
  | `presence:openSettings` | Calls `Linking.openSettings()` — the OS, not us (`InPersonPopup.tsx`). |
  | `settingsScreen:notificationsDisabledMessage` | Refers to the device's own notification settings. |
  | `common:configErrorMessage` | "su configuración" = the app's config payload from `/config`, not a screen. |
  | `accessibility:onboardingProgress` | "configuración inicial" = initial setup / onboarding. |
  | `inPersonScreen` distance comment | Locale/regional settings, in a code comment. |

  The two `openSettings` keys carry inline comments in `es.ts` saying so,
  because they read identically to the ones that were changed.
- `ar` — the path arrow was flipped to `←` for RTL. Confirm it renders pointing
  the way a reader expects inside the bidi run, which is not always what the
  source order suggests.
- `de` — informal `dein`/`trage` matches the surrounding settings block.
- `fr` — "Réglages" was used for the tab; confirm against this file's own
  `mainNavigator:settingsTab` if that key is ever revised.
- `ru` / `uk` — formal register (`вы` / `Ви`) matched to the existing file.
- `th` — no sentence-final punctuation, matching the rest of this file's
  message strings.

---

## 2026-08-14 — "Any" day option (five new keys × eight locales)

Added with the In-Person / Search "Any" day selector. Translations were written
by the implementing session, not by native speakers — **all forty strings want a
review**, and the notes below flag where the risk actually is.

| Key | Namespace | English |
|---|---|---|
| `anyDay` | `listingsScreen` | "Any" |
| `anyDayOnlineHint` | `listingsScreen` | "In-person searches only" |
| `emptyShortTimeAnyDay` | `inPersonScreen` | "No meetings on any day match {{time}}. Tap to pick another time." |
| `emptyNearbyAnyDay` | `inPersonScreen` | "No in-person meetings within {{distance}} on any day — try a wider radius" |
| `emptyFallbackAnyDay` | `inPersonScreen` | "No in-person {{fellowship}} meetings on any day" |

**Why the three empty states are whole new sentences and not a substitution.**
The existing `emptyShortTime` / `emptyNearby` / `emptyFallback` strings bake a
preposition and article around the `{{day}}` slot — `el {{day}}`, `am {{day}}`,
`le {{day}}`, `em {{day}}` — which a weekday satisfies and a quantifier does
not ("el cualquier día"). Interpolating an "any day" phrase would have produced
broken grammar in every Romance and Germanic locale. Do not collapse these back
into one key with a shared phrase; `en.ts` carries the same warning inline.

Specific things to check:

- **`anyDay` is the narrow selector value column**, not just a modal row — it
  renders inside the same cell that otherwise shows "Mon"/"Tue". `uk`
  ("Будь-який") and `fr`/`es` are the longest; confirm none of them truncate or
  wrap the filter grid.
- **`de` — "Beliebig"** was chosen over "Alle" to mean *any one of*, not *all
  of*. Confirm that reads right for a day filter rather than a multi-select.
- **`fr` — "Tous"** is the opposite choice (literally "all"), because
  "N'importe quel" doesn't fit the cell. Worth a second opinion on whether the
  two locales should agree in spirit.
- **`ar` — "أي يوم"** is two words ("any day") where the other locales use one,
  because a bare "أي" reads as an incomplete question word. Check it fits the
  cell in RTL.
- **`th` — "ทุกวัน"** is literally "every day". Thai has no comfortable short
  "any"; confirm this doesn't read as a recurring-daily meeting filter.
- **`de` `emptyShortTimeAnyDay`** was restructured ("An keinem Tag passen
  Meetings zu …") rather than tracking the English word order, which would have
  needed an awkward "an irgendeinem Tag" mid-sentence. Verify the emphasis is
  still on the time filter being the problem — that string's job is to send the
  user to the time picker, not the day picker.
- **`ru` / `uk`** use "ни в один день" / "у жоден день". Both are double
  negatives agreeing with the leading "Нет"/"Немає", which is correct Slavic
  negative concord but worth confirming it doesn't read as emphatic.

---

## Network-aware maintenance — 24 strings (8 locales × 3 keys), 2026-09-06

Three keys added for the offline/maintenance distinction (see `CHANGELOG.md`
and `CLAUDE.md` → "Maintenance Mode"): `common:offlineBanner` is the
blue-grey sticky-banner copy shown when `NetworkStore` reports the device
itself has no connection; `maintenance:offlineTitle` / `offlineSubtitle` are
the cold-start "Device Offline" full-screen pair, sibling to the existing
maintenance-mode full screen. Written by an implementer in all nine locales,
so `es` carries the same review obligation as the other seven per the
2026-08-04 ruling above.

**These strings must not be confused with the existing maintenance-mode
copy.** A user reading `offlineTitle`/`offlineSubtitle` has a dead network
connection on their own device; a user reading the maintenance-mode strings
has a working connection but an unreachable RecoverySky API. Machine
translation has no way to know which failure a locale's existing "service
unavailable" vocabulary implies — a reviewer should confirm the new strings
read as *your device*, not *our servers*.

| Key | English | Notes for the reviewer |
|---|---|---|
| `common:offlineBanner` | You're offline. Showing saved data. | Sticky top banner, replaces the amber maintenance strip when the device has no network (offline wins over maintenance — see CLAUDE.md). Short — it shares the strip's single line with no wrap room. |
| `maintenance:offlineTitle` | You're offline | Cold-start full-screen heading, sibling to the existing maintenance-mode title. Must read as *this device*, not *the service*. |
| `maintenance:offlineSubtitle` | Check your internet connection. The app will reconnect automatically. | Two clauses: an instruction, then a reassurance that no action beyond fixing the connection is needed. Don't drop the second clause — it's what stops a user from force-quitting while waiting for the 15s recovery poll. |

### Reviewer notes worth acting on first

- **All locales** — check `common:offlineBanner` against
  `maintenance:offlineTitle` side by side. Several locales (ar, de, fr, pt,
  ru, th, uk) render both with the same "you are offline" verb but the
  banner is a fragment while the title is a short independent sentence;
  confirm neither reads as a truncation of the other.
- `ar` — "أنت غير متصل بالإنترنت" (title) vs "أنت غير متصل" (banner) differ
  only by the trailing "بالإنترنت" ("with the internet"); confirm the
  shorter banner form doesn't read as ambiguous (offline from what?) without
  it.
- `de` — "Du bist offline" matches the informal register used elsewhere in
  this file's onboarding/settings blocks; confirm that's still the intended
  register for a full-screen error state, not just a settings hint.
- `th` — no sentence-final punctuation, matching the rest of this file's
  message strings; `offlineSubtitle`'s two clauses are joined without an
  explicit conjunction, native to Thai but worth a native check that the
  "automatic reconnect" clause doesn't read as a separate, disconnected
  sentence.
- `es` — informal register matches the existing file. First `es` string in
  this doc's queue since the 2026-08-14 "Any" day batch.

## 2026-09-09

- common.connectingBanner, errors.attestationUnsupportedMessage, errors.attestationServerFailedMessage — English placeholder in all eight locales.

## 2026-09-14 — Database recovery overlay (RS-024), 48 strings (8 locales × 6 keys)

`database.keychainUnavailable`, `database.keyLostTitle`, `database.keyLostBody`,
`database.resetLocalData`, `database.resetConfirmTitle`, `database.resetConfirmBody`
— best-effort translations in ar, de, es, fr, pt, ru, th, uk. `keyLostBody` is the
one to check carefully: it has to say plainly that the local data cannot be
recovered without the key, that Reset starts fresh on this device only, and that
cloud-backed-up attendance syncs back after sign-in. `resetLocalData` is also the
destructive button label in the confirm dialog, so it must read as an action.

## 2026-09-14 — Cloud-backup pass + encryption sentence, 32 strings (8 locales × 4 keys)

`settingsScreen.cloudBackupPassTitle`, `settingsScreen.cloudBackupPassMessage`
(new), plus a sentence appended to `settingsScreen.subscriptionSuccessBackupMessage`
and `settingsScreen.cloudBackupHint` (existing) — best-effort translations in ar,
de, es, fr, pt, ru, th, uk. The sentence to check is the encryption claim: it must
say the attendance data is encrypted **on the device**, **in transit**, and **at
rest in the cloud** — all three, no more and no less, because it is a factual
statement about the system. `cloudBackupHint` is a one-line Settings subtitle, so
its shorter form ("on your device, in transit, and in the cloud") is fine as long
as the three places survive. `fr` is inconsistent on purpose: the prompt strings
use *tu* to match the existing purchase prompt, the hint keeps the existing *vous*.

## 2026-09-17 — Passwordless login and wrong-account recovery (25 new keys × 8 locales)

Two new top-level translation objects (`loginScreen` additions and the new `wrongAccountScreen` block) for the passwordless email-code flow plus device-ownership recovery screen (specs 1–2). Written by an implementer in all nine locales, so `es` carries the same review obligation as the other seven per the 2026-08-04 ruling above.

**Passwordless login is blocking OTA release**, so native-speaker review needed before the go-live OTA.

| Key | Location | English | Notes |
|---|---|---|---|
| `continueWithEmail`, `continueWithApple`, `continueWithGoogle` | `loginScreen` | Three auth method buttons | Match existing button register. |
| `sendCodeTo` | both | "Send code to {{email}}" | Appears twice: once setting the email, once confirming it. Both interpolate the user's chosen address. |
| `useDifferentEmail` | `loginScreen` | "Use a different email" | Secondary action on the confirmation screen. |
| `emailLabel`, `emailPlaceholder` | `loginScreen` | "Email address", "you@example.com" | Form field label and placeholder. |
| `sendCode` | `loginScreen` | "Send Code" | Primary button to trigger the OTP. |
| `codeSentTo` | `loginScreen` | "We sent a code to {{email}}" | Confirmation message after OTP dispatch. |
| `codeLabel` | `loginScreen` | "6-digit code" | Form field label for the code entry box. |
| `verify` | `loginScreen` | "Verify" | Primary button to submit the code. |
| `resendCode` | `loginScreen` | "Resend code" | Secondary action when the user needs a new code. |
| `resendIn` | `loginScreen` | "Resend in {{seconds}}s" | Countdown shown while resend is rate-limited. `{{seconds}}` is a live counter. |
| `wrongEmailGoBack` | `loginScreen` | "Wrong email? Go back" | Link to return to email entry without submitting the code. |
| `errorWrongCode` | `loginScreen` | "That code didn't match. Check the email and try again." | Inline error under the code field on mismatch. |
| `errorCodeExpired` | `loginScreen` | "That code has expired. Tap Resend to get a new one." | Inline error when the code has aged out. |
| `errorTooManyAttempts` | `loginScreen` | "Too many attempts. Please wait a few minutes and try again." | Shown when the user has exhausted per-code attempts. |
| `errorSendRateLimited` | `loginScreen` | "We've sent several codes to that address recently. Please wait before requesting another." | Shown when the email address has hit the send-rate limit. |
| `title` | `wrongAccountScreen` | "This device is set up for a different RecoverySky account." | Modal/screen heading explaining the situation. |
| `body` | `wrongAccountScreen` | "Sign in to that account to continue. Your meetings and records are safe." | Reassurance that the user's data is not lost — they just need to use the right account. |
| `support` | `wrongAccountScreen` | "If you can't sign in to that account, contact support@recoverysky.app" | Escalation path for users locked out of the original account. |
| `sendCodeTo` | `wrongAccountScreen` | "Send code to {{email}}" | Same key as above (reused), but context is resetting device ownership. |
| `signInWithGoogle`, `signInWithApple` | `wrongAccountScreen` | Two auth method buttons | Matching the register of the passwordless buttons above. |
| `cancel` | `wrongAccountScreen` | "Cancel" | Dismiss the screen (users can sign in to the installed account if they choose not to switch). |

### Reviewer notes worth acting on first

- **All locales** — the two `sendCodeTo` strings are a **reused key** appearing in both `loginScreen` and `wrongAccountScreen` contexts. Both are "send a code to this email"; the interpolation is the same. If your locale has any register nuance between "choose your email and we'll send a code" (passwordless setup) vs "reset device ownership by sending a code to your account" (recovery), you could split the key — **but it's not worth a backend schema change.** Confirm both contexts read naturally with the same string.
- **`errorWrongCode` and `errorCodeExpired` both reference tapping/actions** ("Check the email", "Tap Resend"). Verify your translations still name the action the user should take, not just the technical failure.
- **`resendIn` is the only string here with a live numeric interpolation.** `{{seconds}}` arrives as a countdown (60, 59, 58, …). Test on device that the result reads naturally in countdown mode, not just as a static example ("Resend in 60s"). The string updates every second.
- **`wrongAccountScreen:title` is unusually long for a heading.** It is the modal's title on a fixed-width small sheet; confirm it doesn't wrap awkwardly in your language. If it does, it can be restructured — the rules aren't as tight as a tab bar label.
- **Term consistency:** `wrongAccountScreen` uses "Google" and "Apple" as bare brand names for the buttons, matching `loginScreen:continueWithGoogle` / `continueWithApple`. Verify all three are translated identically (or intentionally left as bare names in your locale).
