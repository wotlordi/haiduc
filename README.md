# Haiduc

A small Obsidian-style notes site: Markdown notes, `[[wiki links]]`, backlinks and a task board, shared live between the people on a members list.

Static site (GitHub Pages) + Supabase (database, email sign-in, live updates).

## Setup

1. **Supabase:** create a project. In **SQL Editor**, run `supabase/schema.sql` after replacing the two example emails at the bottom with the real ones.
2. **Supabase → Authentication → URL Configuration:** set **Site URL** to the site address (e.g. `https://wotlordi.github.io/haiduc/`) and add the same address under **Redirect URLs**.
3. **config.js:** paste the Project URL and the anon public key (Project Settings → API).
4. **GitHub Pages:** repository Settings → Pages → Deploy from branch → `main` / root.

## Adding or removing people

In Supabase SQL Editor:

```sql
insert into public.members (email) values ('new.person@example.com');
delete from public.members where email = 'old.person@example.com';
```

Anyone can request a sign-in link, but only emails in `members` can read or change anything. The database rules enforce this, not the page.

## Files

- `index.html`, `style.css`, `app.js`: the site
- `config.js`: Supabase connection (the anon key is public by design)
- `supabase/schema.sql`: tables, access rules, live updates
