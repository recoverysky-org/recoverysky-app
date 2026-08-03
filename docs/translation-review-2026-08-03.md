# Translation review queue — In-Person UI branch (2026-08-03)

**133 machine-assisted strings awaiting a native-speaker pass before release.**

Standing ruling (Jenova, 2026-08-03): implementers write best-effort
translations in all nine locales now, and every string gets listed here for
review before the release ships. `en` and `es` were authored in the plan and
are **not** in this queue — they need no review.

The seven locales needing review: **ar, de, fr, pt, ru, th, uk**.

| Namespace | Keys | Locales | Strings | Authored in |
|---|---|---|---|---|
| `inPersonPopup` | 10 | 7 | 70 | Task 9 |
| `inPersonScreen` | 9 | 7 | 63 | Task 10 |
| **Total** | | | **133** | |

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
