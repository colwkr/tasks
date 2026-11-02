# Tasks

Personal to-do list. A web app added to the Home Screen, published with GitHub Pages from `main`.

- **Data:** Nerve's Supabase project (`dejcovbqwlrvniitbdqv`), table `public.tasks`, rows with `kind = 'task'`. These are the same rows POS shows, so either app can add to and check off the same list. Rows are locked to their owner (row-level security); sign-in is the Nerve account (email and password).
- **Layout:** each section is a group, like a Monday board, with its own color down the left edge and columns: check, task, time (When in Overdue and Upcoming), length, ⋯. Tap a name to rename it in place, tap the time to set it, tap the length or ⋯ for everything else. Checking a task off asks first; unchecking doesn't.
- **The list:** Overdue (an earlier day, not done), Today, Tomorrow, Upcoming (by day, then time), Unsorted (no day). Finished tasks stay crossed off under Today until the day ends; Nerve's `clear-finished-tasks` job removes them after that and keeps unfinished ones.
- **A task:** title, day, optional start time (`at_time`), length in minutes (`mins`, set with hour and minute wheels; new tasks start at 15 minutes, both wheels at 0 means none), Work or Personal (`tag`), notes. Repeating tasks, list items and project steps belong to POS and aren't shown here.
- **Moving:** hold a task (or press and drag with a mouse) to lift it. Drop it in the same section to reorder (saved as `pos`, the same order POS uses), in Today or Tomorrow to move it to that day, in Unsorted to take its day off, or in Upcoming to give it the day of the task beside it. Text can't be selected on the list, so holding never brings up the copy menu.
- **Live:** changes from any device arrive by Supabase realtime.
- **Updates:** `version.json` and `window.APP_V` in `index.html` must match. Open copies reload when `version.json` changes.
- **Look:** the twinkle palette: midnight navy `#202332`, sand `#bc9876`, slate `#434e60`, mist `#8b9a9f`, Nunito type, soft raised cards and a starry sky (`stars.svg`) behind the list.
