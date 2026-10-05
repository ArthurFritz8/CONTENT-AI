import type { StoryContext, StoryVisual } from "./schema.ts";

const xml = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
/** Repo-owned vector artwork. No stock photo impersonates an invented character. */
export function storyArtwork(context: StoryContext, visual: StoryVisual, orientation: "portrait" | "landscape", focus = false): string {
  const portrait = orientation === "portrait", w = portrait ? 1080 : 1920, h = portrait ? 1920 : 1080;
  const colors = { home: ["#ebe0cf", "#ad8f74"], office: ["#d2e5e6", "#63878c"], garden: ["#cbe9d5", "#679474"], street: ["#dbe4f1", "#8996ad"] };
  const [wall, floor] = colors[visual.setting];
  const onStage = visual.on_stage.map(id => context.bible.cast.find(c => c.id === id)!).filter(Boolean);
  const ground = portrait ? 1350 : 850;
  const size = portrait ? (onStage.length === 3 ? 1.03 : 1.45) : 1.2;
  const cast = onStage.map((c, i) => {
    const x = w * ((i + 1) / (onStage.length + 1));
    const speaking = c.id === visual.speaker_id;
    const scale = size * (focus && (speaking || (visual.speaker_id === "narrator" && i === 0)) ? 1.12 : 1);
    const brow = visual.mood === "angry" ? 'M-62 -244l36 14 M26 -230l36 -14' : visual.mood === "sad" ? 'M-62 -230l36 -14 M26 -244l36 14' : 'M-60 -244q18 -10 36 0 M24 -244q18 -10 36 0';
    const mouth = visual.mood === "happy" ? 'M-33 -173q33 38 66 0' : visual.mood === "sad" ? 'M-32 -162q32 -30 64 0' : 'M-28 -170q28 14 56 0';
    const head = c.appearance === "grape"
      ? [-1, 0, 1].map(row => [0, 1, 2].map(col => `<circle cx="${(col - 1) * 55 + (row === 1 ? 0 : 8)}" cy="${-245 + row * 46}" r="53" fill="${c.color}"/>`).join("")).join("")
      : c.appearance === "robot" ? `<rect x="-110" y="-332" width="220" height="205" rx="34" fill="${c.color}"/><path d="M0 -332v-38" stroke="#253847" stroke-width="12"/><circle cy="-385" r="16" fill="#f7d77d"/>`
      : c.appearance === "pear" ? `<path d="M0 -345C-75 -365 -64 -287 -95 -247C-144 -167 -85 -109 0 -109S144 -167 95 -247C64 -287 75 -365 0 -345Z" fill="${c.color}"/>`
      : c.appearance === "strawberry" ? `<path d="M-105 -277C-110 -378 110 -378 105 -277C82 -167 15 -100 0 -111C-15 -100 -82 -167 -105 -277Z" fill="${c.color}"/>${[-60,0,60].map(x => `<path d="M${x} -297l4 9 M${x} -193l4 9" stroke="#ffd6a0" stroke-width="5"/>`).join("")}`
      : `<ellipse cy="-235" rx="112" ry="112" fill="${c.appearance === "human" ? "#e1aa87" : c.color}"/>`;
    const leaf = !["human", "robot"].includes(c.appearance) ? '<path d="M0 -339q-10 -48 12 -54" fill="none" stroke="#755537" stroke-width="12"/><path d="M8 -360q65 -57 70 -6q-25 34 -70 6" fill="#437953"/>' : '';
    return `<g transform="translate(${x} ${ground}) scale(${scale})">
      <ellipse cy="10" rx="133" ry="23" fill="#253847" opacity=".15"/>
      <path d="M-52 -63l-5 65M52 -63l5 65" stroke="#253847" stroke-width="42" stroke-linecap="round"/>
      <rect x="-84" y="-170" width="168" height="139" rx="46" fill="${c.appearance === "human" ? c.color : "#344f60"}"/>
      <path d="M-84 -131l-50 75M84 -131l${speaking ? "65 -35" : "50 75"}" stroke="${c.color}" stroke-width="27" stroke-linecap="round"/>
      ${head}${leaf}<ellipse cx="-43" cy="-215" rx="18" ry="23" fill="white"/><ellipse cx="43" cy="-215" rx="18" ry="23" fill="white"/>
      <circle cx="-39" cy="-213" r="9" fill="#253847"/><circle cx="47" cy="-213" r="9" fill="#253847"/>
      <path d="${brow}" fill="none" stroke="#253847" stroke-width="10" stroke-linecap="round"/>
      ${visual.mood === "surprised" ? '<ellipse cy="-165" rx="16" ry="22" fill="#253847"/>' : `<path d="${mouth}" fill="none" stroke="#253847" stroke-width="8" stroke-linecap="round"/>`}
      <rect x="-120" y="-458" width="240" height="55" rx="26" fill="${speaking ? "#253847" : "#ffffff"}"/>
      <text y="-422" text-anchor="middle" font-size="28" font-weight="700" fill="${speaking ? "#ffffff" : "#253847"}">${xml(c.name)}</text>
    </g>`;
  }).join("");
  const furniture = visual.setting === "garden"
    ? `<path d="M0 ${ground - 360}Q${w / 2} ${ground - 590} ${w} ${ground - 360}V${ground}H0Z" fill="#82b991"/><circle cx="${w * .8}" cy="${h * .2}" r="66" fill="#fff2ad"/>`
    : visual.setting === "street" ? `<rect x="60" y="${h*.25}" width="${w*.31}" height="${ground-h*.25}" rx="12" fill="#e9d5bf"/><rect x="${w*.68}" y="${h*.3}" width="${w*.3}" height="${ground-h*.3}" rx="12" fill="#cfdae2"/><path d="M60 ${h*.32}h${w*.31}M${w*.68} ${h*.37}h${w*.3}" stroke="#e9987f" stroke-width="38"/><path d="M0 ${ground+105}h${w}" stroke="#c5cdd4" stroke-width="60"/>`
    : `<rect x="${w * .08}" y="${h * .22}" width="${w * .22}" height="${h * .25}" rx="18" fill="#fff8e9"/><path d="M${w * .19} ${h * .22}v${h * .25}" stroke="${floor}" stroke-width="15"/><rect x="${w * .69}" y="${h * .32}" width="${w * .24}" height="${h * .19}" rx="20" fill="#809696" opacity=".4"/>`;
  const props = {
    none: "",
    key: '<circle cx="-50" r="44" fill="none" stroke="#f0c869" stroke-width="18"/><path d="M-7 0h100m-20 0v30m-35-30v23" fill="none" stroke="#f0c869" stroke-width="20"/>',
    letter: '<rect x="-95" y="-55" width="190" height="120" rx="8" fill="#fff5dd"/><path d="M-90-45L0 15l90-60" fill="none" stroke="#a9825c" stroke-width="6"/><circle cy="20" r="18" fill="#cf6c70"/>',
    box: '<path d="M-80-45H80v120H-80Z" fill="#b78c61"/><path d="M-80-45l30-45H50l30 45Z" fill="#d9b586"/><path d="M0-90V75" stroke="#f4d19c" stroke-width="20"/>',
    phone: '<rect x="-48" y="-88" width="96" height="170" rx="19" fill="#253847"/><rect x="-38" y="-65" width="76" height="110" rx="6" fill="#b8e3df"/><circle cy="64" r="8" fill="#e2ddce"/>',
    book: '<path d="M0-40q-52-35-95-20v120q50-16 95 15q45-31 95-15V-60Q52-75 0-40Z" fill="#fff3d5" stroke="#7e638b" stroke-width="8"/><path d="M0-35V70" stroke="#b8aeb7" stroke-width="5"/>',
  };
  const prop = visual.prop && visual.prop !== "none" ? `<g transform="translate(${w*(onStage.length===3 ? .87 : .5)} ${portrait ? 455 : 355})"><circle r="132" fill="#ffffff" opacity=".82"/>${props[visual.prop]}</g>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${wall}"/><rect y="${ground - 170}" width="${w}" height="${h}" fill="${floor}"/>${furniture}<g font-family="sans-serif"><rect x="55" y="50" width="280" height="52" rx="26" fill="#253847"/><text x="195" y="85" text-anchor="middle" font-size="23" fill="white">FICÇÃO ORIGINAL</text><text x="60" y="160" font-size="${portrait ? 34 : 40}" font-weight="700" fill="#253847">${xml(context.bible.title.slice(0, portrait ? 40 : 70))}</text><text x="60" y="206" font-size="27" fill="#48616d">Capítulo ${context.chapter_number} de ${context.bible.chapters.length}</text>${prop}${cast}</g></svg>`;
}
