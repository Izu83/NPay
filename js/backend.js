// NPay backend — talks to Supabase. Accounts, balances and payments live in the database;
// every money move goes through a database function that checks it (see supabase/migrations).
const Backend = (() => {
  const cfg = window.NPAY_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase?.createClient);
  const sb = configured
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

  const MESSAGES = {
    "NPAY:insufficient": "Not enough money",
    "NPAY:terminal_insufficient": "The shop doesn't have enough money to give this",
    "NPAY:already_used": "This code was already used",
    "NPAY:expired": "This code has expired",
    "NPAY:not_found": "This code doesn't exist",
    "NPAY:own_code": "That's your own code",
    "NPAY:own_account": "You can't send money to yourself",
    "NPAY:no_account": "That account no longer exists",
    "NPAY:bad_amount": "Enter an amount, like 4.50",
    "NPAY:signed_out": "You're signed out — sign in again",
    "Invalid login credentials": "Wrong email or password",
    "Email not confirmed": "Confirm your email first (check your inbox), then sign in",
    "User already registered": "There's already an account with this email",
    "Database error saving new user": "That username was just taken — try another",
  };

  function friendly(err) {
    const raw = String(err?.message || err || "Something went wrong");
    const key = Object.keys(MESSAGES).find((k) => raw.includes(k));
    const e = new Error(key ? MESSAGES[key] : /fetch|network/i.test(raw) ? "Can't reach NPay — check your connection" : raw);
    e.code = key || "";
    return e;
  }

  async function run(promise) {
    const { data, error } = await promise;
    if (error) throw friendly(error);
    return data;
  }

  let me = null;

  async function session() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session;
  }

  async function loadMe() {
    const s = await session();
    if (!s) return (me = null);
    const [profile, wallet] = await Promise.all([
      run(sb.from("profiles").select("*").eq("id", s.user.id).single()),
      run(sb.from("wallets").select("balance").eq("id", s.user.id).single()),
    ]);
    me = { ...profile, email: s.user.email, balance: wallet.balance };
    return me;
  }

  async function refreshBalance() {
    const w = await run(sb.from("wallets").select("balance").eq("id", me.id).single());
    me.balance = w.balance;
    return me.balance;
  }

  async function signUp({ email, password, username, name, color, avatar }) {
    if (!(await run(sb.rpc("username_available", { p_username: username })))) throw new Error(`@${username} is already taken`);
    const data = await run(sb.auth.signUp({ email, password, options: { data: { username, name, color } } }));
    if (!data.session) {
      const e = new Error("Almost there: confirm your email (check your inbox), then sign in.");
      e.code = "confirm";
      throw e;
    }
    await loadMe();
    if (avatar) await updateProfile({ avatar }).catch(() => {});
    return me;
  }

  async function signIn(email, password) {
    await run(sb.auth.signInWithPassword({ email: email.trim(), password }));
    return loadMe();
  }

  async function signOut(scope = "global") {
    unsubscribeAll();
    await sb.auth.signOut({ scope }).catch(() => {});
    me = null;
  }

  async function updateProfile(fields) {
    const row = await run(sb.from("profiles").update(fields).eq("id", me.id).select().single());
    Object.assign(me, row);
    return me;
  }

  async function verifyPassword(password) {
    const { error } = await sb.auth.signInWithPassword({ email: me.email, password });
    if (error) throw new Error("Password is wrong");
  }

  async function changePassword(oldPw, newPw) {
    await verifyPassword(oldPw);
    await run(sb.auth.updateUser({ password: newPw }));
  }

  async function deleteAccount(password) {
    await verifyPassword(password);
    await run(sb.rpc("delete_account"));
    await signOut("local"); // the user is gone on the server; just forget the session here
  }

  const history = (limit = 100) =>
    run(sb.from("transactions").select("*").order("created_at", { ascending: false }).limit(limit));
  const getProfile = async (id) =>
    (await run(sb.from("profiles").select("id, username, name, color, avatar").eq("id", id).limit(1)))[0] || null;
  const sendMoney = async (to, amount, note) => (me.balance = await run(sb.rpc("send_money", { p_to: to, p_amount: amount, p_note: note || null })));
  const createRequest = (kind, amount, label, note) =>
    run(sb.rpc("create_request", { p_kind: kind, p_amount: amount, p_label: label, p_note: note || null, p_minutes: 5 }));
  const cancelRequest = (id) => run(sb.rpc("cancel_request", { p_id: id })).catch(() => {});
  const getRequest = async (id) => (await run(sb.rpc("get_request", { p_id: id })))[0] || null;
  const settleRequest = async (id) => (me.balance = await run(sb.rpc("settle_request", { p_id: id })));

  // ---- live updates
  const channels = new Set();
  function listen(name, filter, cb) {
    const ch = sb.channel(name + ":" + Math.random().toString(36).slice(2))
      .on("postgres_changes", filter, (payload) => cb(payload.new))
      .subscribe();
    channels.add(ch);
    return () => { sb.removeChannel(ch); channels.delete(ch); };
  }
  function unsubscribeAll() {
    channels.forEach((ch) => sb.removeChannel(ch));
    channels.clear();
  }
  // Every new line in your history (money in or out), as it happens.
  const onTransaction = (cb) => listen("tx", { event: "INSERT", schema: "public", table: "transactions", filter: `user_id=eq.${me.id}` }, cb);
  // A terminal waiting for its code to be paid.
  const watchRequest = (id, cb) => listen("req", { event: "UPDATE", schema: "public", table: "payment_requests", filter: `id=eq.${id}` }, cb);

  const onAuthChange = (cb) => sb?.auth.onAuthStateChange((event) => cb(event));

  return {
    configured, get me() { return me; },
    loadMe, refreshBalance, signUp, signIn, signOut, updateProfile, changePassword, deleteAccount,
    history, getProfile, sendMoney, createRequest, cancelRequest, getRequest, settleRequest,
    onTransaction, watchRequest, onAuthChange, unsubscribeAll,
  };
})();
