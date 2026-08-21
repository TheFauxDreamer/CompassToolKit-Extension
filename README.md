# Compass Toolkit

Nine Compass improvements in one extension. Each can be turned on or off from
the menu on the toolbar icon, along with its own settings. Switching something
on or off takes effect straight away on any Compass tab you already have open.

Everything is on by default except **Chronicle Anywhere** and **Hide Support
Button**, which start off.

## Timetable Printer

Adds a **Print Timetable** button to the Schedule tab of a staff or student
profile, and opens a clean, printable version of the week.

If the selected week is missing a day, the button says so instead, so you don't
print a half-empty timetable.

- **Quick print**: skip the preview and open the print dialogue straight away.

The print view also has a black-and-white mode for printing without colour.

## Clearance Form

Adds a **Clearance Form** button to a student's profile that builds a printable
clearance sheet from their timetable, with one row per subject and columns for
the teacher, comments and a signature.

- **Quick print**: skip the preview and open the print dialogue straight away.
- **Year 12 only**: only show the button on Year 12 student profiles. Turn this
  off to use it for any year group.

The button never appears on staff profiles.

## Term Calendar Printer

Captures a whole term from the Compass calendar and opens it as a printable
page.

Open your calendar in **Term** view, then use **Capture calendar data** in the
menu, followed by **Open printable calendar**. The printable page offers a term,
monthly, weekly list or daily list layout, and lets you:

- show one term or all of them
- filter by calendar layer
- hide weekends
- switch between A4 and A3
- adjust the event text size to fit more on the page

## Chronicle Anywhere

*Off by default. Turn it on in the menu.*

Compass only lets you create a chronicle entry from the Chronicle page. This
adds a **New Chronicle** button to every page that opens the entry form in a
pop-up over whatever you're looking at, so you never navigate away or lose your
place.

The form in the pop-up is Compass's own, so entries save exactly as they would
if you'd gone to the Chronicle page yourself.

- **Button position**: which corner the button starts from, either bottom left,
  bottom right or top right.
- **Show just the form**: hide the Chronicle page sitting behind the entry
  form. Turn it off if the form ever looks wrong.
- **Close when finished**: close the pop-up automatically once the entry is
  saved or cancelled.

The button slides along the edge to sit beside anything already in that corner,
such as the Compass help bubble or this toolkit's own timetable buttons, and it
doesn't appear when you're already on the Chronicle page. With **Hide Support
Button** on there's no bubble to avoid, so it sits flush in the corner.

## Chronicle Snippets

The same chronicle entries get written over and over, so this offers pre-written
wording from a small **Snippets** button inside the entry form's own fields.
Pick one and its text drops into that field. Compass saves the entry exactly as
if you had typed it.

It comes with eight to start from: minor injury, head knock, sick bay, late to
class, out of uniform, mobile phone, positive recognition and contacted home.
Each uses `[square brackets]` to mark the bits to fill in. Edit them, delete the
ones you don't want, and add your own from the menu.

A snippet can name a **chronicle field**. When it does, its button only appears
in fields whose label contains that name, so an injury snippet can sit in the
injury field and nowhere else. Part of the label is enough: `details` finds both
"Details" and "Entry details". Leave the field blank and the snippet is offered
in every field of the entry form, which is how the built-in ones ship. The
fields on a chronicle entry are set up per school, so the extension can't guess
their names.

- **Button placement**: the button is put inside the field itself, so it scrolls
  with the form the way everything else on it does. If that ever upsets a
  school's chronicle layout, set it to **Floating** and the button hovers over
  the field instead, touching nothing on Compass's own form.
- **Insert a snippet**: where the text goes when the field already has something
  in it, either at the cursor, at the end, or replacing what's there.

The button appears wherever the entry form opens: the Chronicle page, a
student's profile, or inside the Chronicle Anywhere pop-up. Fields that aren't
free text, such as the type dropdown and date pickers, are left alone, and a
field no snippet matches doesn't get a button at all.

Snippets are synced with your Chrome profile, so they follow you between
machines. Chrome caps how much can be synced; if you ever hit it, the menu says
so rather than losing the snippet.

## Clean Staff Directory

Hides system and support accounts from the staff directory so you only see real
people.

- **Hide names containing**: an editable list of phrases. Any staff card whose
  name contains one of them is hidden. Comes with `(DOE Integration)`,
  `(Program Kaartdijin)`, `Kaartdijin` and `(STIMS)`; add or remove as you like.

## No New Tabs

Stops Compass opening a new tab every time you click something.

- **Keep School Favourites in new tabs**: links under the School Favourites
  menu, and the Outlook link, still open in a new tab.
- **Open links inside posts in a new tab**: links in news feed posts and rich
  text open in a new tab so you don't lose your place in the feed.

Turn the whole feature off and every link goes back to behaving the way Compass
intended.

## Hide Support Button

*Off by default. Turn it on in the menu.*

Hides the Compass help and support bubble that sits in the bottom-left corner
of every page.

Turning it off brings the bubble straight back, with no reload needed.

## Quick Attendance Notes

Clicking the **Attendance Notes require review** alert on the home page normally
drops you on the Attendance page's default tab. With this on, it opens the
**Notes** tab directly.

Navigating to the Attendance page any other way is left alone. Only the alert
triggers the jump.
