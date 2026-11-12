# Local App Studio user guide

This guide follows the way you work: from an idea to an installer. Each section names the screen it is about. Words in **bold** are buttons, tabs or labels you will see. Screenshots are not in the repository yet; the sections describe each screen in words.

## 1. What Local App Studio does

You describe an app in plain words. A helper on this computer (Ollama) makes a first design. You check it, change it if you like, try the app, and make a Windows installer you can share. Everything happens on this PC. Your descriptions and your data never leave it.

The words used in Studio:

- **Step**: one of the five stages of making an app (Prompt, Design, Data, Preview, Build).
- **Page**: one screen of your app.
- **Part**: a built-in piece you put on a page, such as a heading, a table of records or a form.
- **Feature**: a saved group of parts you can reuse. Your own are called "Your features".
- **Menu bar**: the bar of buttons and links that shows on every page of your app.
- **Table** and **field**: the information your app keeps, and one piece of it. A **record** is one row, for example one crew.
- **Preview data**: the records you add while you try the app in Preview. It is kept apart from any app you build.
- **The helper**: Ollama, running on this computer.
- **Installer**: the Windows file you share.
- **App file**: an exported app. **Feature file**: an exported feature.

## 2. The five steps and the save rule

Open an app from the **Apps** page and you see, from top to bottom:

- The header: **Apps** (back to the list), the app name, a save status line, **Help** and **App settings**.
- The step rail: **Prompt**, **Design**, **Data**, **Preview**, **Build**, then **Back** and **Next** buttons at its right end. They are in the same place on every step.
- The step heading: "Step 2 of 5", the step name and one sentence about it.

What the rail tells you:

- A check mark on a step means it is done: Prompt once you have used a design the helper made for this app and none is waiting (an app made from your words with **Make my app** counts too); Design once some page has more than the starter heading; Data once there is at least one table; Preview once you have seen the app running at its latest saved design; Build once an installer exists for the latest saved design. Preview and Build marks, and the note that you used a helper design, are remembered in this browser only.
- The step you are on is highlighted. The step Studio suggests next has a ring around its number.
- **Next** is greyed out, with a reason under it, when something must be dealt with first: a design from the helper that you have not used yet, a part on a page that needs a table, or a table marked **Needs a fix**. A part you chose to **Keep it this way** under Data connections does not hold **Next**.

**The save rule.** Moving to another step saves your changes first. You do not have to press **Save** before you go. If the changes cannot be saved (for example a part needs a table), Studio says why and asks: **Discard changes** or **Stay**. **Save** and Ctrl+S save without moving. The save status in the header reads "All changes saved", "Saving...", or "Unsaved changes on Design" (or Data, or both).

**The browser Back and Forward buttons ask too.** They follow the same rule as the step rail: if you have changes that cannot be saved, or the helper is still working, Studio shows the same question before it goes back or forward. Choose **Stay** to stay where you are.

**Changes are kept if the page closes.** Unsaved changes on Design and Data are also kept in this browser. When you open the step again you see "You have unsaved changes on Design from ..." (or Data) with **Restore** and **Discard**. **Restore** puts them back ("Restored your unsaved changes."); **Discard** drops them. If the app changed in the meantime, the line adds "The app changed since, so check it before you save." If you only moved to another step and came back to Design in the same visit, the line says "Your unsaved changes on Design are still here." instead.

**If the app was deleted in another window**, the question "Your changes on Design cannot be saved yet" has an **Export a copy** button that saves your design as a file before you press **Discard changes**.

**Leaving the app.** If the helper is still working, or its design is waiting on Prompt, leaving the app asks first ("Stop the helper and leave?" or "Leave without using the helper's design?"). Choose **Stay** to keep it.

**Help.** Press **Help**, or the ? key when you are not typing in a box, to open "Help and keyboard shortcuts": the five steps, the save rule and every shortcut.

## 3. Your first app

1. Open **Apps** from the menu and press **Create**. The card "What do you want to build?" opens above your apps, with the cursor in the box. **Cancel** closes it. (Words you typed before and did not use open it by themselves.)
2. Type what you want in the **Your prompt** box, for example "a crew roster for my painting business, with who leads each crew". The box takes up to 2000 characters. Your words are kept in this browser: if you reload, go back or leave and reopen the app, they are still in the box on Prompt.
3. Press **Make my app** (or Ctrl+Enter in the box). The app gets a short name taken from your words. If your words hold a name you wrote with capital letters, such as "Green Acre Landscaping", that is the name; if not, it is the first two words that matter. You can rename it later in **App settings**.
4. Studio opens the app on **Prompt** and the helper starts. The pane beside your prompt says "The helper is working" and lists what it is doing; this can take a few minutes. **Cancel** stops it.
5. When the design is ready, it shows in the same pane under "What the helper made", Studio tells you, and the focus moves to it. Check it (section 4), then press **Use this** or **Use this and try it**.

**If the first run fails.** When the helper fails or you cancel it, and you leave an app that is still the untouched new app, Studio removes that empty app and puts your words back in the box on the Apps page, with the line "Removed the empty app <name>. Your words are back in the box." So trying again does not leave numbered empty apps behind. An app you changed or saved is never removed.

**If the helper is not ready.** Ollama is a free app that runs AI models on this computer.

1. Install Ollama from https://ollama.com/download.
2. Open it from the Start menu. If it does not open, open a terminal and run `ollama serve`.
3. If a model is missing, press the download button in the "Set up the helper (Ollama)" card. The download starts only when you press it.
4. Press **Check again**.

On the Apps page, with the helper known to be down, **Make my app** makes no app. The setup card shows under the box, your text stays in the box, and **Start a blank app instead** opens the blank app dialog with a name made from your words.

**No helper, or you prefer to do it yourself.** Press **Blank app** on the Apps page, give it a name (2 to 40 letters, digits and single spaces, starting with a letter) and press **Create app**. The app opens on Prompt, which offers **No helper? Build it yourself, starting with tables on Data** (an app with tables offers **No helper? Build it yourself in Design**). Tables come first, so an app with none starts on Data; Design then also says "Start with your tables on Data." with **Go to Data**. A new blank app starts as a plain pearl-white sheet, until you choose a look.

## 4. Prompt, with the review beside it

Prompt is where you write your words and where you check what the helper made before anything is used. Your prompt is on the left and the review is on the right. On a window narrower than 1024 pixels the review sits below the prompt. Pressing Tab goes through the prompt box and its buttons first, then the review.

The helper designs; it cannot read your files or change your settings. Code checks every design before you see it, and when you ask for a change it keeps the tables and fields you did not ask to remove.

The review pane shows one of these things, each under its own heading.

**The helper's design is waiting** ("What the helper made" for a new app, "Your changes" when you asked to change an existing app). While a design waits, **Make my app** (or **Ask for changes**) is a quieter button and **Use this** is the main one. You see:

- "You asked for:" with your words. A long ask is cut at a word and ends in "...". When you have asked for more than one change on the same design, "Asked before:" lists the earlier asks under it, and "You asked for:" shows only the newest.
- When you asked for a change (see **Ask for a change** below), a line for each thing you asked: "Done: <your words>" or "Not done: <your words>". Next to a "Not done" line there is a button that takes you to the place where you can do it yourself: **Do it on Data** (a table or field), **Do it in Design** (a page or part) or **Change the look in Design** (a color or look word). Under them, **It also changed** lists changes you did not ask for, eight at most, then "and 3 more changes". A line is "Done" only when the design now has what it names: "three tiles across the top" needs Number tiles on the page it names (a heading that repeats your words is not a tile), and "a table for tutors with a date" needs the date on that table. A rename is "Done" only when the old name is gone from every place that showed it, or, for "Rename the Jobs table to Projects", from that table's own name; if not, the line ends "(still says Jobs in the menu)". If the new design is the same as the one before it, the pane says "Nothing changed." If nothing you asked was done, it adds "The helper did not do what you asked. Try other words, or do it yourself."
- A red box, "These changes remove or reshape data", when the design would delete or change data. Read it before you go on.
- A few short bullets in plain words. The first says what the app is ("Crew Roster keeps People and Crews on 1 page."), then one line per table with its fields ("Crews: Name, Size, Lead, Status"; hover a line to see the field types), then one line per page ("Home shows a Crews list."; a page may end "It opens from a list." or "It is not in the menu."). A part that cannot connect to data is named ("Home: a Checklist that needs a yes or no field"). When the design changes the look or the menu bar, a line says so ("Look: Slate"). When there is no ask to judge, the bullets list what a change added, removed or changed ("Added a Phone field to People"), eight at most, then "and 3 more changes".
- On a first design, **Not made:** lists what your words named that the design does not have, for example "Not made: Clients, Jobs, a chart, a menu button". A view you asked for with only some records ("a list of only people who haven't paid", "which repairs are still open") is listed too when no page filters that table. It only lists what it is sure of, so a missing line does not prove everything was made. Add the rest yourself in Design and Data, or press **Try again** and word it differently.
- Notes for parts the helper could not make. After you use the design, add those yourself in Design.
- Three buttons: **Use this** saves the design and takes you to Design. **Use this and try it** saves it and takes you to Preview. **Try again** throws the design away, keeps your words, and puts the cursor back in the prompt box ("Change your words, then press Make my app.") so you can change them. On a design made by asking for a change, the cursor goes to the Ask box instead ("Change your words, then press Ask.").
- **Show everything** (below the buttons) opens the full summary with the field types. A page line there is followed by its own sentence, "It opens from a list." or "It is not in the menu bar." Inside it, **Show every change** opens the full list of changes.
- **Ask for a change**: a one-line box and **Ask**. This is the only box on Prompt to ask for a change in. Type a change and press **Ask**; the helper changes the design that is waiting (it does not start again from your first words), and "You asked for:" shows your newest ask. You stay on Prompt. When the answer comes, Studio announces "The helper changed the waiting design. Check it, then press Use this." (a new design from **Make my app** that takes the place of a waiting one is announced as "The helper made a new design in place of the one that was waiting.").

**A waiting design is kept with the app.** Studio keeps the helper's design, your words and your asks for the app as soon as the helper answers. If you close the window, open the app in another browser, or come back tomorrow, Prompt shows the same design with **Use this**, **Try again** and **Ask**. On the **Apps** page the app's card says "A design is waiting: 1 table, 2 pages." The design is thrown away when you press **Use this** or **Try again**, when you press **Make my app** for a new design, or when you delete the app. If an ask fails or you cancel it, the waiting design stays as it was and the pane says "Your change was not made. The design below is as it was."; **Try again** asks the same change again. If you saved the app in Design after the helper made the design, the design can no longer be used: the pane says "You saved the app after this design was made. Make a new design to use the helper again." with **Try again** (a new design from your words) and **Throw it away**, and nothing holds you on Prompt. If another window saved the app while you asked, Studio loads the newer app and says "This app was saved in another window, so the waiting design is out of date."

If the helper suggested nothing new, the pane (headed "Your changes") says "The helper suggested no changes. Try other words." and offers **Try again** and **Ask for a change**. When you asked for a change and the design came back the same, the pane says "Nothing changed." and shows what happened to each thing you asked, with **Try again**. An answer with no changes is not a waiting design: the header still says "All changes saved" and **Next** is not held.

Nothing is saved until you press **Use this** or **Use this and try it**.

**The first design can be tried at once.** When the helper's first design has two or more pages in the menu, the menu bar is on, across the top. A table that a page lists but nothing in the app adds to gets a form under its list, so you can add records in Preview without building anything first. The bullet for that page says "a Crews form". It does this only for a first design; a change you ask for keeps your choices.

**The helper is working.** "This can take a few minutes on this computer." and the list of what it is doing.

**The helper could not make a design.** The pane says so, gives the reason, keeps your text, and offers **Try again** (it runs the same words again) and **Build it yourself in Design** (on an app with no tables, **Build it yourself, starting with tables on Data**).

**No design waiting.** The pane, headed "Your app", shows the same bullets for the app you have, **Show everything** and **Ask for a change**. Typing a change there and pressing **Ask** asks the helper to change the app.

**One box to ask in.** On an app that already has a design, the left side shows the first prompt as words you read, not a box: "Your first prompt" (or "There is no first prompt for this app. Ask for a change in the box on the right." when none is kept). Studio also keeps your first prompt on the computer when you press **Use this**, so another window or browser shows it too; Duplicate does not copy it yet. The only box to ask for a change in is **Ask for a change** on the right. To write a whole new prompt for the app, press **Start over with a new prompt**; that brings back the **Your prompt** box and **Make my app**, and **Change this app instead** goes back.

**A new app with nothing in it.** "Nothing to check yet." and "Write your prompt and the helper's design shows here."

## 5. Design

Design is where you build the pages. The screen has a strip and a toolbar on top, a shelf on the left and the page on the right.

**The page strip.** Above the toolbar, a row labelled **This page** says in one line what the open page shows ("Home shows a Crews list."). If you gave the helper words for this app, a second line shows the start of them (`Your words: "a crew roster for ..."`). The box **Ask the helper to change this page** with **Ask** is a shortcut to the helper: type what should change on this page and press **Ask**. Studio saves your changes first, opens Prompt and asks the helper for a change that starts "On the page Home: ...", and you check the answer in the review pane there. While the helper works, or a design is waiting, the strip says so ("The helper is working on a design." or "The helper's design is waiting on Prompt.") with **Open Prompt**, because asking again would throw the waiting design away.

**The toolbar.**

- **Go to the page** is a skip link and the first Tab stop in the toolbar. It is hidden until it has focus; press Enter on it to jump to the first part of the page.
- **Page** picks the page you are working on. Pages that open from a list read "(opens from a list)".
- **Page actions**: **Add a page**, **Page settings**, **Show one record on this page** and **Delete this page** (off for the home page and when it is the only page). Changing page or using a page action saves your changes first, like any move.
- **Undo** and **Redo**. After either one the line above the page says what it took back or brought back, for example "Undid: moved Tabs down." with **Redo**, or "Redid: moved Tabs down." with **Undo**.
- On an app with no tables a line above the page says "Start with your tables on Data." with **Go to Data**.
- **Save as feature** (needs a selected part).
- **Save** keeps the page and the look. It is greyed out when there is nothing to save or when a part needs a table (the reason is shown next to it).

**Add parts.** The **Features** tab of the shelf lists parts and features. Use **Search parts and features** and the **Show** buttons (one per category: Layout, Navigation, Records, Input, Actions, Your features, plus all of them) to narrow the list; the count reads "N shown". On a tile, **Add** puts the part after the selected part, or inside it when it can hold it; the shelf note says which ("Add puts it after Heading."). You can also drag a tile onto the page. A small **Add here** button shows at the places a part can go; press it, then press **Add** on a tile. On a page with one part or none, a line above the page reminds you how.

**Change a part.** Select it. Double click it, or press Enter on it, to open **Settings for <part>**. The settings open with the first thing to change (the text of a heading, the list of a table of records). The panel has, in order: which table it uses, **What it does** (buttons), the words and choices of the part, and **Width** last. **Apply** changes the page; **Save** keeps it. The block toolbar on a selected part has the drag handle, **Settings**, **Add a tab** (on Tabs), **Move up**, **Move down**, **Shrink**, **Widen**, **Beside**, **Move to...** and **Delete**. Every change says what happened in a line above the page, with **Undo**: adding a part, applying settings, moving, undoing and redoing all have words, for example "Added Form after Table of records." **Move to...** lists the places as "<place>, place 1", "<place>, place 2" and so on, with no gaps in the numbers, and marks the place the part is in now with "(here)". Enter or Space on the drag handle opens it and says "Moving <part>. Pick a place."

**Columns and Tabs.** **Add a column** (in Columns settings) and **Add a tab** (in Tabs settings) add one more. A new Columns, Tabs or Auto grid starts with empty places that say **Add here**, so there is no placeholder text to delete. In a part's settings, picking a table for a part that had none connects it at once and says "Connected to <Table>."; there is nothing to **Apply** in that case.

**Number tile.** In its settings, **Show** picks **How many**, **Total of a number**, **Average of a number**, **Lowest of a number** or **Highest of a number** (the number choices need a number field). A Number tile's label starts as "Sum of <field>" or "Average of <field>" when it adds up a field, or "Count of <table>" when it counts. It follows the field and list you pick until you type your own label.

**Words that follow the table.** Other words Studio wrote for a part follow it too: a Quick add or a menu button that reads "Add to Crews" becomes "Add to Jobs" when you change its table, a Chart titled "Crews by Status" becomes "Jobs by Status", and a Progress bar labelled "Crews" is renamed the same way. Only words that are still exactly what Studio wrote change. Words you typed yourself stay as you wrote them.

**Chart.** In **Group by**, a date field reads "Date out (by month)" (or "(by day)" when the chart groups dates by day), so you can see how dates are grouped. Records with no date are counted under "No date".

**Form on a record page.** A Form on a page that shows one record presets the link field that points to that record's table, when a new record is added (unless the field has a default of its own).

**Table of records and List of records.** Both ask which **Table** to use, the same word a Form uses. **Columns** (Table of records only) ticks which fields show: up to 8, and with none ticked it shows the first five. **When a row is clicked** is **Does nothing** or **Opens <page>**: a page that shows one record of the same table. When the app has one such page for the table, new lists open it by default, so a click on a row opens the record in Preview and in the built app.

**Put parts side by side.** Press **Beside** on a part, then **Add** on a tile: the new part goes to the right and both take half the row. Or drag a tile or a part onto the thin bar at the left or right of another part. Drag the handle between two parts side by side (or focus it and press Arrow left or Arrow right) to give one more room. **Shrink**, **Widen** and the **Width** setting do the same in steps. On a narrow window the parts stack.

**Place parts freely.** A Grid can put each part at a column and row of your choice instead of flowing the parts one after the other. Select the Grid, open **Settings for Auto grid** and turn on **Place parts freely**. Each part keeps its order and gets a cell, so the page looks the same at first. From a medium window up the Grid has 12 columns; on a narrow window the parts stack in one column, in reading order.

- **Add and move.** Drag a tile onto the Grid. Dotted cells show the 12 columns and the rows, and the cells the part would take are outlined with **Drop here** (free) or **Cells taken** (not free). A new part is 3 columns wide and 1 row high. Drag a part by its handle to move it. Two parts cannot share the same cells: "Two parts cannot share the same cells. Move or resize one of them to empty cells."
- **Resize with the mouse.** Select the part. A handle on its right edge changes the width and a handle on its bottom edge changes the height; drag to a cell.
- **Keys.** With the part selected, Alt+Arrow moves it one cell and Alt+Shift+Arrow resizes it by one cell (left narrower, right wider, up shorter, down taller). The handles also take the Arrow keys, Home (smallest) and End (as large as the free room allows). Each change is said aloud, for example "Moved to column 4, row 2." or "Now 6 columns wide, columns 4 to 9." A key that cannot move the part says why ("Cannot move right: Heading is in column 5." or "Column 12 is the last column.").
- **Without Alt.** Alt+Shift can switch the Windows input language when you have more than one keyboard layout installed. The **Place** section of the settings does the same without Alt: **Column**, **Width in columns**, **Row** and **Height in rows** (type a number and press Enter or leave the box, or use the arrow keys in the box), and **Fill the row**. On a placed part, **Move to...** lists **Choose column and row...** first; it opens these boxes with the cursor on Column.
- **Back to the old way.** Turn **Place parts freely** off. Studio asks "Stop placing parts freely?" and says "Their places are forgotten. The parts stay, one after the other. Ctrl+Z brings them back." **Keep places** is the safe choice; **Stop placing freely** goes on.
- A part placed freely has no **Move up** or **Move down**, and no **Width** setting: its place decides.

**Connect a part to a table.** A part that shows or adds records, and a feature that uses a table, carries one small pill that says where it stands. There are three: green "Connected to Crews", amber "Needs a table" and amber "Needs a yes or no field" (it names the kind of field that is missing). A part that uses no data, such as a heading or a button, has no pill. When you add a part, Studio connects it for you: to a list the page already has or, when only one table fits, to a new list of that table ("Added a list of Crews to this page."). When several tables fit, the part is placed with "Needs a table" and its settings open so you can pick one, or you press **Connect** on it. This also holds on a page that already lists a table: if the app has other tables that fit and the page has room for another list, you are asked which table, with the page's lists first, instead of the part joining the list without a word. When no table fits, the part says so: **This app has no table yet**, or "Needs a yes or no field" (or the kind it needs). Press **New table** to make one right there: give it a name, keep or change the fields Studio suggests (a Checklist gets a yes or no field "Done", a Chart a choice "Status"), and press **Make table** (a table with no name says "Give the table a name."). Or press **Add a field** to add the missing field to a table you have (it names the field the way the Data step does: a number, a decimal, a yes or no, a date, a choice or a link). A **Linked record picker** needs a link to another table: on an app with no table, New table makes the first one and says "Make a second table, then the Linked record picker connects to it"; press New table again and the picker connects to the second. If a page already has the most lists, the part says so and you remove a list in Page settings first. Page settings and the menu bar point to New table too when the app has no table yet. When Studio connects a part for you, the line above the page says so ("Connected the Form to People."). When you must pick, the part offers every table, and a table that cannot fit says why. The settings of a part start with its pill and one line about what it does with the table: "It shows records.", "It shows one record.", "It adds records." or "It edits this record." Press the green pill on a part (**Change table**) to pick another table or make a new one. Undo takes the table, its list and the connection away together. The new table is saved with the page and shows in the Data step. A part that needs a table cannot be saved: connect it or delete it. On the shelf and on the Features page a tile that cannot connect where you would add it says "Needs a table". A feature that needs a table on a page where none fits opens **New table for <feature name>**; after you press **Make table** the feature is added, connected to it ("Made the table Crews and added Crew list to this page."). A Quick add or Form that adds to a table the page does not show is listed under **Data connections**: use **Change table**, or **Keep it this way** if you meant it. Until you save, a new list shows sample rows on the page. An app made from an example shows the example's own records on the page ("Showing the sample records of this example.") until Preview runs your latest save; then it shows the Preview rows, and a page for one record opens the first real record. A Number tile or Chart ignores a typed search and follows only the filter bar.

**Fix all.** When the Data connections list has a problem on the page you have open, **Fix all** sits beside its heading. One press connects every part of this page that has one clear table, and the line above the page says what happened, for example "Connected 3 parts. 1 still needs a table." It also counts the parts that still add to a table the page does not show ("1 still adds to a table the page does not show.") and the problems on other pages ("1 more is on another page."), and it changes none of those. When several tables fit a part, it stays listed so you can pick. Parts you marked **Keep it this way** are not changed or counted. **Undo** takes the whole press back in one step. When nothing can be connected by itself, the line says "Nothing could be connected by itself." and nothing changes.

**A way to add records.** Records are added in your app, so each table needs a Form, a Quick add or a menu button that adds to it. When a table has none, a line under the Data connections list says "Crews has no way to add records yet." (it names every table, for example "Crews and Steps have no way to add records yet.") with **Add a way to add records**. With a menu bar on, it adds a button for each table at the end of the bar ("Add to Crews"). Without one, it puts a Form after the first list of that table on the open page. The line above the page says what it added, for example "Added a menu button for Crews and a Form for Steps on Jobs.", and **Undo** takes it all back in one step. A table that is not shown anywhere gets no Form: the line says "Nothing shows Vendors yet: put a list of it on a page first." A table whose list is on another page says "Open Jobs to add one for Steps."; a full page says "Jobs has no room for a Form for Steps." Nothing changes until you press the button.

**The Look tab.** Press **Look** on the shelf.

- **Menu bar**: **No menu bar**, **Across the top** or **Down the side**, and **Menu shows** words only or icons and words. With a bar on, **Add a button to the menu bar** adds a button at its right (or bottom) end, and **Show the parts** goes back to the Features tab, where **Add here** on the bar puts other parts on it (Button, Link, Search box, Quick add, Text and Row fit; saved features do not). The sides of the bar are named "Menu bar, left" and "Menu bar, right" across the top, and "Menu bar, top" and "Menu bar, bottom" down the side. A new menu button reads "Add to <Table>" and opens a form to add a record; change **What it does** in its settings to make it go to a page instead. A search box on the bar searches the first list of the page that is open. Number tiles and Charts keep their totals while you search; only the filter bar narrows them. On the canvas the bar shows the icons you chose (with **Menu shows** icons and words) and the open page lit.
- **Look**: **Plain** (white and simple), then eight themes (Slate, Paper, Midnight, Forest, Sand, Ocean, Rose, Mono; each tile says how it starts, for example "Green and natural. Starts dark."), then **Accent color**, **Corners** and **Starts as** (Theme default, Light or Dark). Changes show on the page right away; press **Save** to keep them. Picking another look keeps your accent, corners and **Starts as** choices. A new app starts on Plain.

**Show as.** In the strip on top of the page canvas (and in the strip on top of the app in Preview) **Show as: Light / Dark** chooses how Studio shows your app. It is a view choice only: it is kept per app in this browser and is not saved in the app. By default the app shows light unless its theme is dark (Midnight, Forest, or a theme set to start dark).

**Save as feature.** Select a part, press **Save as feature**, give it a name and say what it is for (the helper reads that to know when to use it), tick which settings people can change when they add it (each is shown in your app's own words, for example "List: Open crews" or "Field: Status"), and choose **Save as a new feature** or **Replace one of your features**. If a part still reads "Text", the dialog warns you to change its words first. Press **Save feature**. The part on the page then uses the feature; press **Save** to keep the page. **Open in the builder** (section 10) saves the page and opens the Feature builder with your selection.

**Page settings.** In **Page actions**, **Page settings** has the page's title, its web address in the app (fixed for the home page), whether it shows in the menu (with a menu label and an icon), and the lists of records the page shows, for example all Crews, or only the ones where Status is active. Two pages cannot have the same title: Studio says "A page called <title> already exists. Pick another title." here and in **Add a page**.

**Add a page** asks "What kind of page?". **A page of parts** is an empty page you fill. **A page that shows one record from a table** takes a **Table**, gives the page an address with a record number, keeps it out of the menu and adds a Record details part. A Table of records or List of records of that table that opens nothing then opens it. To turn a page you already have into one, press **Show one record on this page** in **Page actions** (not for the home page). Its dialog says "This page will open from a list, one Crews record at a time. It leaves the menu and shows the record's details." A Record details part that you try to put on a plain page says to use that action.

**Delete this page** checks first. If a button, link or row click on another page, or on the menu bar, still goes to the page, a list names each one ("The Button on Home goes to this page.") and says "Change where it goes first." There is no red button until they go somewhere else; press **Close**. Otherwise it asks "Delete the page <title>?" as before.

## 6. Data

Data is where you set up the tables your app keeps. The card **Tables** has a list of tables on the left and the selected table on the right.

- **Add table** adds a table with one **Name** field that names each record. Rename it or add more fields with **Add field**. A table needs a name: an empty one says "Give the table a name."
- Each field has a name, a type (Text, Long text, Number, Decimal, Yes or no, Date, Date and time, Choice, Link to another table) and a **Required** box. Under the type, a line reminds you: "Number holds whole numbers. Decimal holds amounts like 12.50." A Decimal always shows two decimals (12.5 reads 12.50). Choices and links are set in the field's row. Inside names, default values and which pages read a table are under **More options**.
- To link records between tables you need a second table first; with one table the screen says so and offers **Add table**.
- **Move <field> up**, **Move <field> down** and **Delete field** work on a field. **Delete table** removes the whole table.
- **Add table** and **Add field** put the cursor in the new name box with its text selected, so you can type the name at once. Press Enter to add the next field. The inside name follows the name you type until the table or field is first saved.
- **Undo** and **Redo** take back and bring back changes in Data (Ctrl+Z and Ctrl+Y when you are not typing in a box). Removing a field or a table is not asked about; press **Undo** in the line that appears. After Undo the line says what it did ("Undid: removed the field Amount.") with **Redo**; after Redo it says "Redid: Removed the field Amount." with **Undo**.
- **Save** keeps the tables (Ctrl+S too). If saving would delete preview data, Studio asks first: "Save and remove data?" with **Save and remove** or **Keep editing**.
- A table with a problem shows **Needs a fix** and each problem says what to change. **Next** stays off until you fix it. Pages that use what you changed are listed under "These pages use what you changed. Fix them in Design:".
- **When Save is grey, the reason is beside it.** If you removed a field or a table that parts still use, it names the pages in plain words ("Page Jobs still uses what you removed. Press Remove it from those parts too, or fix it in Design."). **Remove it from those parts too** takes it out of those parts (columns, group by, filters and sorts) in one step, and **Undo** takes it back. If a link field of another table pointed at a table you removed, that link field goes too and the line names it ("Took it out of the parts that used it, and removed the link field Client from Jobs."). Moving a field says what it did ("Moved Amount up."). If a table itself has a problem, the reason is "Some tables need a fix before they can be saved."
- Unsaved Data changes are kept in this browser. Opening Data again offers them with **Restore** or **Discard** (see section 2).

Records are added in your app, not in Data. Put a **Form** on a page, then add records in Preview. **Add a form in Design** takes you to Design with the Form tile picked.

After a save that adds a table with no way to add records, a line under the save line says "Crews has no way to add records yet." with **Add a way to add records**. It adds a menu button for the new table (or a Form on a page that lists it) and saves the app once. Without a menu bar and a list of the table, the line says "Show it on a page in Design first." and has no button. Nothing is added until you press the button. The offer goes away at your next edit, Undo, Discard or step change.

### Numbered automatically

A text or whole-number field can be numbered by the app, for invoice or ticket numbers. Open the field's **More options** and tick **Numbered automatically**. For a Text field set **Starts at**, **Before the number** (for example "INV-") and **Digits**; a line shows what you will get ("INV-1001, INV-1002, INV-1003"). A Number field has only **Starts at**.

- Only one field of a table can be numbered, and a numbered field has no default ("A numbered field has no default."). If another field is numbered, the box is off and says "Only one field of a table can be numbered. <Field> already is."
- In your app the field is never typed: a form shows "Numbered when saved" when you add a record and the stored number when you edit one. The app gives the next number when the record is saved, and a number is never used twice, even after you delete a record.
- Importing records or restoring them from an export keeps the next number above the highest one stored. One limit: if you restore an older backup, the app hands out again the numbers it gave after that backup was made, because it cannot know about records that left it.
- The helper does not write numbering yet; add it here. When the helper changes a table it keeps the numbering you set.

### Automations

Under a table, **Automations** lists what the app does for you when a record is saved, in plain words: "When Paid is ticked, set Paid on to today." The Invoices and Clients example has two, one that sets Paid on to today when Paid is ticked and one that clears it when Paid is unticked.

- **Add an automation** takes one row: the field to watch (a Choice or a Yes or no field), the value it must become, the field to set and what to set it to: today, now, empty, a value you type, or another field's value. **Remove** takes an automation away; to change one, remove it and add it again.
- An automation runs once when a record is saved, only on that record, and never starts another automation. It does not run when a record is saved without the watched field changing to that value, so saving a form that still says Paid again does nothing. A value you type yourself in the field it would set is kept.
- After a save, the form says what it did: "Saved. Paid on was set to today."
- If you remove a field an automation uses, the table shows **Needs a fix** with the automation named and **Remove this automation**; **Undo** brings it back.
- Automations do not run on imported rows unless you tick **Apply automations** (see Import rows below).
- The helper does not write automations yet; add them on the Data step. When the helper changes a table, it keeps the automations that still fit and the review lists any it had to drop ("Automation removed: ...").

## 7. Preview

Preview runs your app right in the page. It starts by itself for an app that has a design. On a new app that has no tables and only the starter heading, Preview says "Describe it on Prompt, or build a page in Design." with **Go to Prompt** and **Build a page in Design**; once any page or table is saved, the app runs.

- The top card says "Starting your app...", "Your app is running." or "The preview is stopped." (with **Start preview**). **Preview options** has **Restart** and **Stop**.
- Your app is shown in a frame. Its top strip has **Show as** (Light or Dark) and **Enlarge**. **Enlarge** fills the window with your app; **Shrink** or the Escape key returns to the page. A dialog your app opens (a form, a confirmation) carries the app's look and the Light or Dark you chose, as the built app shows it.
- "Preview data stays on this computer, apart from any app you build." The records you add stay when you stop and start Preview and through table changes a built app could take too (adding a table or an optional field): Preview says "Your table changes were applied. The records you added are kept." A change that cannot keep them, such as removing a field, clears them and says so.
- **Reset preview data** deletes every record you added in Preview, after you confirm ("Keep the records" cancels). Your design and any app you built are not changed. An app made from an example gets its sample records back: Preview says "Preview data was reset. The sample records are back."
- If the preview cannot start, the card says "The preview could not start." once, with **Try again** and **Reset preview data**. Reset preview data and its confirm clear the preview data and start the preview again, so a stuck preview is back in two steps.
- If a table has no way to add records, Preview says "Crews has no way to add records yet." (it names every such table) with **Add a way to add records**. The button saves the app once with a menu button or a Form for each, and says what it added with **Undo**; you stay in Preview. When nothing can be added from here, the line ends "Put a Form on a page to add them here." and the button is **Add a form in Design**.
- **Import rows** (while the preview runs) brings rows from a spreadsheet saved as CSV into one table: pick the table and the file, press **Check rows**, then **Import <n> rows**. See "Import rows from a spreadsheet" in section 9. In Preview a file can be up to about 2 MB and 5000 rows; a larger one is refused with "This file is too large for Preview. In Preview a file can be up to about 2 MB and 5000 rows." and nothing is sent. These are practice records: **Reset preview data** puts the sample back. If an import takes too long, some rows may already be added, so check the total before you import again.
- If you save a newer design, Preview says "Updating the preview with your latest changes...".
- **Change something**: type what should change and press **Ask for changes** (the helper makes a new design that you check on Prompt), or press **Change the design yourself** to go to Design. **Ask for changes** is off while the box is empty. It is also off, with the reason under it, when the helper is not set up, while the helper is still working on a design, and while a design waits on Prompt (press **Use this** or **Try again** there first). When the helper's last run failed, a note under the buttons says "The helper could not answer last time. Ask for changes may work now, or change the design yourself."

A **failed start** shows "The preview could not start." with the reason when there is one, **Try again** and **Reset preview data**.

## 8. Build

Build makes the Windows installer. The card **Make an installer** shows:

- **Build tools**: each tool says Found or Missing, in plain names (Node.js, Rust, Cargo, Microsoft C++ build tools, Windows SDK, WebView2). A missing tool says how to install it in plain words (for example "Install Rust from rust-lang.org, then press Check again."). When a required tool is missing, the card says "This computer needs ... before it can make an installer." and keeps the list under **Details**. Install what is missing, then press **Check again**. When everything is found the list folds into "Build tools: ready" with **Show tools**.
- The **Allow downloads for builds** switch. The build downloads packages from the internet, so it is off until you allow it. Under the switch, "Needed once per build. Nothing about your apps or data is sent." and, under **Details**, the sites it contacts ("It contacts: ..."). You can also change it in Settings, Network.
- A line "Before you can make an installer: ..." lists what is left (tools, and turning on "Allow downloads for builds").
- **Make installer**. The first build on this PC takes 5 to 15 minutes. While it runs you see **Progress**, a timer, **Show build log** and **Stop build** (it asks "Stop this build?"; **Keep building** goes on).

When it finishes, **Result** shows "Your installer is ready." and the path. Press **Copy path**, then find the file in that folder. **Show details** has the size and the SHA-256, a fingerprint you can use to check the file was not changed, with **Copy SHA-256**. The installer is not signed, so Windows may warn when you run it. A failed build says which step it stopped at; open **Show build log**, fix what it says and press **Make installer** again. **Earlier builds** lists past builds.

## 9. Your apps

The **Apps** page has one card per app with its description, how many tables and pages it has and when you last edited it. When the helper has made a design for the app that you have not used yet, the card adds "A design is waiting: 1 table, 2 pages."; open the app to check it on Prompt. **Installer built** means a build made an installer. **Needs repair** means the app is damaged. Click a card to open the app: a designed app opens on **Design**, a new one on **Prompt**.

On the **Apps** card: **Import an app** (pick an app file, up to 600 KB, exported from Local App Studio; if another app already has the file's name, the import is named apart, for example "Crew Roster 2", and the line says `Imported "Crew Roster" as "Crew Roster 2".`), **Blank app** and **Help**. **More actions** on a card has:

- **Change look**: opens the app's Design with the Look tab.
- **Duplicate**: asks for the copy's name first, filled with the app's name and "Copy" (for example "Job Green Copy"). Pick another name if you like, tick **Keep the records from Preview** if the copy should start with the records you added (it is off), and press **Duplicate**. Studio says `Duplicated "Job Green" as "Green Acre North Site". The copy starts with no records.` An app made from an example keeps its sample records, so its copy says "The copy starts with the sample records." instead.
- **Export**: saves the design as a file named after the app, for example "Job Green app.json". **Export with records** is described under "Export with records" below. The file holds the design only. The records you added in Preview stay on this computer, and Studio says so: `Exported "Job Green" as Job Green app.json. It holds the design. Records added in Preview stay on this computer.`
- **Delete**: asks "Delete <name>?". Apps you already installed are not affected.

**App settings** (in the app header) has the name, a description, an icon, and under **More options** the Windows app name (Windows uses it to tell your app apart; keep it after the first installer) and the version (the installer shows it; raise it when you share a new installer).

**A built app and its look.** A built app starts light unless its theme says dark, then the person using it can switch between Light and Dark in the app's Settings. A Classic app (no theme) starts light too.

**What a built app shows.** The design as Preview shows it, plus two small buttons, Assistant and Settings, at the end of the menu bar (in the bottom right corner when the app has no menu bar). Nothing else is drawn around it: no greeting, clock, search box or Welcome dialog. Settings has Appearance, AI, Data and storage, Privacy and activity, Network and About this app (the version, where the data lives and **Look at your data**), with a **Back to <app name>** link at the top. The first press of Assistant after the app starts offers to set it up when it is not ready; after that it opens directly. Opening the Assistant does not ask the model for advice by itself. The Assistant reads your records through a fixed list of tools, can only save a record after you press **Approve**, and cannot delete anything. Help in the window menu has About, Open data folder and Export my data.

**Uninstalling a built app.** The uninstaller keeps the person's data and the browser storage (the WebView2 profile). It removes only the app's log files, its window position and its install-folder registry key, and a folder only when it is then empty.

**A damaged app.** Opening it shows "This app cannot open because part of it is damaged. Export a copy first, then try a repair." with **Export a copy**, **Delete app** and, under **Advanced repair**, the app file text to fix by hand.

### Examples

Under the **Apps** card, the **Examples** card shows eight small apps that already work: Crew Board, Job Tracker, Invoices and Clients, Inventory, Appointments, Expense Log, Membership and Attendance and Reading List. Each card shows its look, what it is for, what it shows (for example "linked tables, a filter bar"), how many tables and pages it has and its look. The card is in every build, with or without the helper, and an example is never counted as one of your apps.

- Press **Use this example** on a card. Studio makes the app in a moment and opens its **Preview**. While it works the button says "Making your app...". If another app already has the name, the new one is named apart, for example "Crew Board 2".
- Preview says "Made Crew Board from the example. It is yours to change." and, under it, "Ideas to try: ..." with two or three first changes. Press **Dismiss** to hide the note.
- The example comes with **sample records**, so the app is not empty: Preview adds them before it shows the app and says "Sample records were added so you can try the app." The dates in them are set around the day the records are added.
- **Reset preview data** brings the sample records back (and removes what you added). A table change that clears Preview data brings them back too, fitted to the new fields.
- The app is yours: change it in Design and Data like any app. **Export** holds the design only, never the sample records. **Duplicate** copies the sample records with the app. **Delete** removes them with it.
- If Studio cannot make the app, the line at the top says "Could not make the app from the example. Nothing was changed. Try again." Press **Use this example** again.
- An empty Apps page ends with "Or open an example below."

### Import rows from a spreadsheet

In a built app, open a table from **Look at your data** (the data page of a table) and press **Import rows** next to **Export this table**. In Preview, press **Import rows** on the Preview step. Save the spreadsheet as CSV first (a comma, semicolon or tab between columns; the first row names the columns).

1. Pick the file. A built app can also paste rows instead. A built app takes a file up to 16 MB and 200000 rows; Preview takes about 2 MB and 5000 rows.
2. Each column is matched to the field with the same name; a built app lets you change the match or leave a column out ("Left out: Notes."). A numbered field is never filled from the file: the app numbers each row itself.
3. **Check rows** reads the whole file and writes nothing. It says how many rows can be added and how many will be left out, and lists the first problems with their row, for example "Row 58: Due must be a date like 2025-01-31." A link to another table is found by the name of the record there ("Row 201: there is no Clients record named "Acme Ltd"."). Dates are written 2025-01-31.
4. **Import <n> rows** adds the good rows, 500 at a time, and skips the others. A built app offers "Back up first? **Back up now**" before the import. If something stops the import part way, the result says "Nothing from row 1002 on was added." and **Import again from row 1002** carries on.
5. **Apply automations** is off: "Automations do not run on imported rows unless you tick Apply automations."

A cell that starts with =, +, - or @ is kept as plain text and never worked out. Export CSV puts a ' in front of such a cell so a spreadsheet does not treat it as a formula, and importing that file takes the ' off again.

### Export with records

**Export** on an app's card saves the design only. **Export with records** (the next item in **More actions**) saves a ZIP named after the app, for example "Invoices and Clients app.zip", with the design (app.json) and every table as JSON and CSV. The records come from the app's Preview, so start the preview of that app first ("Start the preview of this app first. Its records live there."). An installer never holds records, only the design.

To bring the records back, build and install the app, open its **Settings**, then **Data and storage**, **Import data**, and pick the ZIP. The same ZIP also restores through `npm run import`. Studio itself imports only the design file (app.json), not the ZIP. Imported rows keep their numbers, and the next new record is numbered above the highest one.

## 10. Features

A feature is a small group of parts you can put on any page, such as a row of three numbers over a list. Open **Features** from the menu. Two come ready to use: **Number row** and **Search list**.

The page shows a picture of every part and feature, grouped by category (Layout, Navigation, Records, Input, Actions, then **Your features**). Use **Search parts and features**, the **Show** buttons and the order choice (Default order, A to Z, Recently added). It is the same search and the same names as the shelf in Design. A tile can say "Sample data" when its picture uses made-up rows, and "Needs a table" when it shows rows and so needs a table of an app to connect to.

- **New feature** opens the Feature builder (below).
- **Details** opens a larger picture, what it does, the settings it asks for and, for your own features, "Used in 2 apps" or "Not used in an app yet".
- **Use in app** asks which app, then opens that app's Design with the feature ready to add.
- **Your own features** also have **Edit** (it opens the feature in the builder), **Duplicate**, **Export** and **Delete**. **Import a feature** adds one from a feature file; a feature with the same name but different content is renamed ("Renamed: <a> is now <b>."). Importing the same file again says "<name> is already in your library. Nothing was added." A damaged file says "This feature file has problems, so nothing was imported. Ask the person who sent it for a new export." with **Show what is wrong** for the details. The message takes focus so it is read.
- **Deleting** a feature that an app or another feature uses does not offer a red button: the page says "<name> is used by <apps and features>. Remove it there first." Remove or detach it there first.
- **A damaged feature** shows **Needs repair** and cannot be added. Its details say what is wrong in words and offer **Delete feature**. To get it back, make it again in Design and save it with **Replace one of your features**.
- **The helper** can use your saved features when it designs an app (up to six are offered each time). Feature descriptions stay on this computer unless you allow cloud AI to see them (Settings, AI).

On a page, a feature with settings opens them right away. **Settings** on its box lets you change them, **Update to latest** when a newer version exists, or **Turn into plain parts**.

How the settings read in your app:

- **One choice for what it shows.** A feature that shows records and also adds them asks for the table once, for example "Things to track". Pick a table and the feature's list and its Quick add or form use that same table, so what you add always shows in the list. If the page has no list of that table yet, the setting says "This page gets a list of Tasks." and the list is added when you press **Apply**.
- **Your names, never codes.** Every choice reads in the app's own words: your tables ("Tasks"), fields ("Status", "Created", "Updated") and pages ("Home"), and the lists of the page ("Open tasks").
- **Sensible starting choices.** A setting that groups by a field starts on a choice, yes or no, date or link field of the table, not on Created or Updated unless nothing else fits. A setting for words starts with the words you saw on the canvas of the builder, and a title the builder wrote from its own table ("Add to Things to track") is rewritten for your table ("Add to Tasks").
- **A setting left empty** says "Fill in: <name>." when you press **Apply**, and nothing changes until you fill it in.
- **A table with no name** says "Give the table a name." in the **New table** box.
- **Update to latest.** When the feature has a newer version than the block on your page, the settings say "A newer version is in your library." and open with the newest version's values: settings that are gone are dropped, ones that still fit are kept, and a new one is filled from the feature's own words. **Update to latest** puts the new version in place and says "Updated Status board to the latest version." (with **Undo**). If something still cannot be filled, you see a plain sentence such as "Fill in Title." and no code.
- **Newer version.** A feature block behind your library shows an amber **Newer version** pill beside its connection pill (press it to open the settings), and the page strip in Design says "1 feature on this page has a newer version." (or "2 features on this page have a newer version.").

### The Feature builder

The builder makes a feature without an app. Press **New feature** on the Features page. (From Design, **Save as feature** then **Open in the builder** opens it filled from the parts you selected, and **Edit** on one of your features opens that feature.) The screen is titled "New feature" (or "Edit <name>"), with the line "Put parts together once and use them in any app. The rows you see are sample rows." and a **Features** link back.

It is the same page you know from Design: the shelf on the left, the page in the middle, **Undo** and **Redo** on the toolbar. Drag a part onto it, or press **Add** on a tile. The shelf has no Look tab, and it hides what a feature cannot hold.

- **Slots.** A slot is a place in the feature that people fill in when they add it to an app. This is the one place Studio uses the word. A part that shows records first says "Needs a table". Press **Add a table slot**, give the slot a name (**Shown as**) and pick the **Sample rows** it shows (Crews, Tasks or Items). The part then says "Uses slot Crews". A part that needs a field (a Checklist needs a yes or no field) says so, and **Add a field slot** adds one. The **Slots** panel (to the right of the page from 1280 pixels, below it on narrower windows) lists them: "Table this feature shows", "Field it groups by", "Field it uses", "Page it opens" and "Words you can change", each with its name and "Used by: ...". You can rename a slot there and switch its sample rows (Undo takes either back). A slot nothing uses says "Not used yet".
- **Words you can change.** Tick **Let people change these words** on a text row (a title, a button label) to let people change it when they add the feature. The panel counts the settings: "People can change 3 of 6 things." A feature holds at most 6.
- **Sample rows.** The rows you see in the builder are made up: Crews, Tasks or Items, so a Chart groups, a Checklist ticks and a Timeline has dates. They are not saved in the feature.
- **Save feature.** Press **Save feature**. Give the feature a name and say in one line what it is for ("The helper reads this line to know when to use it."). The first save adds it to **Your features**: "Saved <name>. It is in your features." Every later save makes a new version ("Save a new version"); apps keep the version they already placed until you update them. **Save feature** is off while a part still needs a slot. If something is missing Studio says what, for example "Give the feature a name." or "Some parts still need a table slot."
- **Try it in an app.** Saves first when there is unsaved work ("Save the feature first. Then pick the app."), then asks which app and opens that app's Design with the feature ready on the shelf. On an app with no table, adding it opens **New table for <feature name>**, then connects the feature to the table you make.
- **Edit.** **Edit** on one of your features opens it in the builder with its slots and sample rows. Unsaved builder work is kept in this browser and offered back with **Restore** or **Discard**.

What the builder cannot do:

- Parts that show one record (Record details, a form that edits a record), because the builder has no record page.
- The menu bar and the look: a feature has neither.
- List filters and sort order (Page settings is not in the builder).
- More than 6 settings, 60 parts or 8 levels of parts inside parts.
- A feature that was saved with a one-record setting cannot be opened in the builder: it says "This feature is damaged, so it cannot be opened in the builder." with **Back to Features**.
- A link field between two table slots works only after you add two table slots, then **Add a field slot** of type link.

## 11. Keyboard shortcuts

| Where | Keys | What it does |
| --- | --- | --- |
| Everywhere in Studio | ? | Opens this help |
| Everywhere in Studio | Escape | Closes a dialog or a menu |
| Apps | Ctrl+Enter in the box | Makes the app from your words |
| Design and Data | Ctrl+S | Saves your changes |
| Design and Data | Ctrl+Z | Undoes the last change |
| Design and Data | Ctrl+Y or Ctrl+Shift+Z | Redoes it |
| Design | / | Goes to the search box of the shelf |
| Design | Enter on a part, or double click it | Opens its settings |
| Design | Delete on a part | Removes it (Undo brings it back) |
| Design | Alt+Arrow up or Alt+Arrow down on a part that is not placed freely | Moves it up or down |
| Design | Alt+Arrow keys on a part placed freely on a grid | Moves it one cell |
| Design | Alt+Shift+Arrow keys on a part placed freely on a grid | Makes it one cell wider, narrower, taller or shorter |
| Design | Arrow keys on the width or height handle of a part placed freely | Changes its width or height by one cell |
| Design | Home or End on the width or height handle of a part placed freely | Makes it as small as it can be, or as large as the free room allows |
| Design | Enter or Space on the drag handle | Opens Move to... and lists the places |
| Design | Arrow left or Arrow right on the handle between two parts | Gives one of them more room |
| Design | Arrow left or Arrow right on Features or Look | Switches the shelf tab |
| Design | Escape | Clears the selection, or cancels Add here or Beside |
| Features | / | Goes to the search box || Features | Escape in the search box | Clears the search |

## 12. Troubleshooting

- **Make my app made no app and shows "Set up the helper (Ollama)".** The helper is not ready. Install or open Ollama and press Check again, or press Start a blank app instead.
- **The helper is not running.** Open Ollama from the Start menu, or run `ollama serve`, then press Check again.
- **A model is missing.** Press the download button in the "Set up the helper (Ollama)" card.
- **"The helper could not make a design".** Your text is kept. Press Try again, or reword it. If the reason says the helper "did not give a usable answer", the model gave nothing readable: try again, or press Build it yourself. If it says the helper "could not finish the tables", name the things you keep track of more plainly.
- **"The helper suggested no changes. Try other words."** Press Try again and say the change differently.
- **"This file cannot be imported".** Nothing was imported. Pick an app file you made with Export. Press Show what is wrong for the details.
- **Next is greyed out.** The line under it says why. Prompt: press Use this or Try again. Design: connect or keep the parts listed under Data connections. Data: fix the tables marked Needs a fix.
- **Save is greyed out on Design.** A part needs a table. Press Connect, New table or Add a field on it, or delete it.
- **"Your changes on Design cannot be saved yet".** Press Stay and fix what the dialog says, or Discard changes to leave without them.
- **"This app changed in another window".** Your change was not saved. The newer version is already loaded behind your edits, and your edits stay on screen until you leave. To keep both, note your change and make it again.
- **"You have unsaved changes on Design from ..."** Studio kept them when the page closed. Press Restore to get them back, or Discard.
- **"Save and remove data?"** The change deletes preview data. Press Keep editing, or Save and remove.
- **"Save and remove data?" on Design.** You undid a table or a field that was already saved. Press Keep editing to keep it, or Save and remove to remove it and its Preview records.
- **Preview says "The preview could not start."** Press Try again. If it fails again, press Reset preview data and confirm: it deletes the records you added in Preview, then starts the preview again (your design is not changed).
- **Preview says a table has no way to add records.** Press Add a way to add records. If it cannot, press Add a form in Design, add the Form and save.
- **A part says "Needs a table" or "Needs a yes or no field".** Press Connect on it and pick a table. If it says the app has no table, or the pill names a field no table has, press New table or Add a field.
- **A feature shows Needs repair.** Open its details, read what is wrong and press Delete feature, or make it again in Design and save it with Replace one of your features.
- **"This app cannot open because part of it is damaged".** Press Export a copy first, then try Advanced repair, or Delete app.
- **Make installer is greyed out.** The line above it lists what is left: missing build tools, the Allow downloads for builds switch, or both.
- **Build tools are missing.** Install what the list says, then press Check again.
- **The build failed.** Open Show build log. The result names the step where it stopped. Fix the cause and press Make installer again.
