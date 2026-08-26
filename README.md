# Compass Toolkit

Twelve Compass improvements in one extension. Each can be turned on or off from
the menu on the toolbar icon, along with its own settings. Switching something
on or off takes effect straight away on any Compass tab you already have open.

Everything is on by default except **Chronicle Anywhere** and **Hide Support
Button**, which start off.

Each feature has its own colour in the menu, so the rows can be told apart at a
glance: the icon, the switch and a stripe down the edge all take it, and the
feature's settings panel follows. Only features that are on are coloured, so
the colour doubles as a sign that something is running. Turn **Colour code**
off at the bottom of the menu and the whole thing goes back to the one accent.

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

Open your calendar in **Term** view and use the **Print Calendar** button in
the bottom-right corner of the page. It opens a small panel with **Capture
calendar data** and **Open printable calendar**, shows what the last capture
picked up, and says so when the calendar is on a view it can't capture from.
Everything is on the page you are already looking at, so there is nothing to
find in the menu first.

The same two buttons are still in the menu if you would rather work from
there, and either place captures for the other.

The printable page offers a term, monthly, weekly list or daily list layout,
and lets you:

- show one term or all of them
- filter by calendar layer
- hide weekends
- hide draft events, meaning anything with `(Draft)` in its name. The option
  says how many there are, and only appears when the calendar has some.
- switch between A4 and A3
- adjust the event text size to fit more on the page

## Preferred Calendar View

Compass always opens the calendar on **Week** view. This switches it to the
view you actually use as the page loads.

- **Open the calendar on**: Day, Week, Month, Term or List. Set to **Term** to
  start with.
- **Start the week on Monday**: lays the Month and Term views out Monday to
  Sunday. On by default.
- **Hide weekends**: leaves Saturday and Sunday out of the Month and Term
  views, so the five school days have the whole width. Off by default.

The calendar is held back until it has settled, so you get the finished view
in one go rather than watching Compass's Week view appear and then be
switched out from under you. If anything stalls it is shown regardless.

It switches once, as the page comes up. Changing view by hand afterwards
sticks, and nothing pulls you back. If Compass is slow to draw its toolbar it
waits for it, and if the view still won't move it leaves the page alone rather
than clicking at it.

Compass already starts its **Week** view on Monday and leaves Month and Term
starting on Sunday, which is the odd split this evens up. It is done by
changing the setting the calendar itself lays out from, so the dates, events
and week numbers all move together rather than the columns being shuffled
around underneath them. Turning it back off takes a page reload.

Hiding weekends takes the columns out rather than painting over them, so an
event running from Friday into Monday still lines up with the days it covers.
Turning it back off puts the weekends straight back, with no reload.

Set this to **Term** and the Term Calendar Printer is always ready to capture,
since that is the view it needs.

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
- **Show everyone on one page**: reads through the directory's pages and puts
  them all in one list. On by default.

Compass pages the directory before any of this hides anything, so a page
arrives with the system accounts still counted in it and comes out short, with
real staff pushed onto a second page. Turning Compass's own page size up cannot
fix that: the largest it offers is a hundred, and a school with more real staff
than that is still split.

With **Show everyone on one page** on, the page size goes to its largest, each
page is read in turn, and the results are put back together under their own
Active and Inactive headings.

The list is covered from the moment Compass draws its first card until it is
finished, so you never see the unfiltered version appear and then have thirty
accounts taken out of it, and you never watch it jump between pages on the way.
While the pages are being read it says **Loading the full staff list**. If
anything stalls, the list is shown regardless.

Searching, sorting and the status filter all behave normally. Each of them
gives a different set of people, so the assembled list is dropped the moment
one changes and Compass's own results are shown instead. If those results
still run to more than one page they are read into one list the same way. The pager disappears and the count is replaced
with one that describes what you can actually see, so **Showing 1-100 of 134**
becomes **Showing all 100 (34 hidden)**. Searching or sorting still works; the
list is rebuilt behind you when it does.

## Staff Card Printer

Compass's own **Download PDF** on the staff directory gives you a list of names
and details. This prints the cards themselves, photo and all, which is what is
actually wanted for a staffroom wall or a relief folder.

Use **Print Staff Cards**, which sits next to Compass's own **Download PDF** on
the directory toolbar and is a copy of that button, so it looks like it belongs
there. If the toolbar can't be found it falls back to a button in the
bottom-right corner rather than not appearing. The printable page lets you
choose:

- A4 or A3, portrait or landscape
- how many cards across, from two to six
- the photo above the details for a wall display, or beside them for a compact
  list that fits far more to a page
- photos or no photos
- colour or black and white

Whatever the directory is showing is what prints, so with Clean Staff Directory
on you get the real staff and none of the system accounts, and with **Show
everyone on one page** you get all of them in one go rather than a page at a
time.

Every sheet is laid out to be exactly one page and every card on it is the same
fixed size, so nothing is ever split across a page break. Cards are then
stretched to fill the sheet, so the leftover paper at the foot of a page goes
into the photos instead of going to waste, and the photo frame is portrait to
match the head shots Compass stores. The text is measured after it is drawn and
the cards grown if anything came up short, so a long name or a long email
address pushes nothing off the bottom.

Photos are copied while the page still has your Compass session and shrunk to
printing size on the way, since the printable page has no session of its own
and would otherwise show empty frames.

## No New Tabs

Stops Compass opening a new tab every time you click something.

- **Keep School Favourites in new tabs**: links under the School Favourites
  menu, and the Outlook link, still open in a new tab.
- **Open links inside posts in a new tab**: links in news feed posts and rich
  text open in a new tab so you don't lose your place in the feed.

Turn the whole feature off and every link goes back to behaving the way Compass
intended.

## Menu Declutter

Compass advertises modules your school has not bought inside its own navigation
menus. This takes them out. They are tagged in the markup, either with a
`feature-demo` class or by pointing at `FeatureDemonstration.aspx`, so they can
be picked out exactly and nothing you actually have access to is touched.

It also hides any subheading left with nothing under it, such as **Activity
Management** or **School Administration**, and any whole menu whose dropdown was
adverts and nothing else.

- **Show module adverts**: off, which is what hides them. Turn it on to have
  Compass's advertising back.
- **Show empty headings**: off, so a subheading or a whole menu with nothing
  left under it goes as well.

Beyond the adverts, the menu can be trimmed to taste. Open the menu on the
toolbar icon with a Compass page open and the panel reads that page's menus and
lists them: every entry with a switch, grouped under the menu it belongs to.
Switch one off and it goes. Each menu's own name has a switch too, for dropping
a whole menu at once.

Every switch in the panel means the same thing: on is on the menu. That is why
the two above are worded as showing rather than hiding, even though both start
off.

Because the list comes off the page rather than being typed in, it only ever
offers what that person actually has, and there is nothing to spell correctly.
The placeholder Compass shows while a menu fills in, such as **Loading Class
Items...**, is never offered, since it disappears on its own. In the rare case
where a menu holds nothing else yet, the list waits a moment for the real
entries rather than showing that menu short.
Open the menu somewhere other than Compass and it says so rather than showing an
empty list.

The hiding is done with a stylesheet rather than by walking the page, so the
adverts never appear and then vanish. Turning the feature off puts everything
straight back, with no reload.

Entries are remembered by their link, so a choice survives Compass rewording a
menu. One that no longer exists is simply never matched.

If Compass renames the `feature-demo` class in a future release the adverts will
come back; the fix is the selectors at the top of
`src/content/feature-menu-declutter.js`.

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
