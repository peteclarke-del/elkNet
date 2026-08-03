import { refreshSortableTables } from "/admin/admin-sort.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let dashboard;

const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";
const formatBytes = (value) => new Intl.NumberFormat(undefined, { style: "unit", unit: "megabyte", maximumFractionDigits: 2 }).format(value / 1_000_000);

function cell(text,sortValue) { const td = document.createElement("td"); td.textContent = text; if(sortValue!==undefined)td.dataset.sortValue=sortValue; return td; }
function emptyRow(columns, text) { const row=document.createElement("tr"); const td=cell(text); td.colSpan=columns; row.append(td); return row; }

function render() {
  const { games, stats } = dashboard;
  elements["game-count"].textContent = games.length;
  elements["host-count"].textContent = stats.devices.length;
  elements["download-count"].textContent = stats.totalDownloads;
  elements.hosts.replaceChildren(...(stats.devices.length ? stats.devices.slice(0,5).map((host) => {
    const row=document.createElement("tr"); row.append(cell(host.id),cell(formatDate(host.firstSeen),host.firstSeen),cell(formatDate(host.lastSeen),host.lastSeen),cell(host.downloads,host.downloads)); return row;
  }) : [emptyRow(4,"No hosts recorded yet") ]));
  elements.downloads.replaceChildren(...(stats.files.length ? stats.files.slice(0,5).map((file) => {
    const row=document.createElement("tr"); row.append(cell(file.path),cell(file.downloads,file.downloads),cell(formatBytes(file.bytes),file.bytes),cell(formatDate(file.lastDownloaded),file.lastDownloaded)); return row;
  }) : [emptyRow(4,"No game downloads recorded yet") ]));
  renderGames();
  refreshSortableTables();
}

function renderGames() {
  const needle=elements["game-search"].value.trim().toLowerCase();
  const downloads=new Map(dashboard.stats.files.map((file)=>[file.path,file.downloads]));
  const games=dashboard.games.filter((game)=>`${game.title} ${game.filename} ${game.publisher}`.toLowerCase().includes(needle));
  elements.games.replaceChildren(...games.map((game)=>{
    const row=document.createElement("tr"); const actions=document.createElement("td"); actions.className="row-actions";
    if(!game.enabled) row.className="disabled-row";
    const edit=document.createElement("button"); edit.type="button"; edit.textContent="Edit"; edit.addEventListener("click",()=>openDialog(game));
    const toggle=document.createElement("button"); toggle.type="button"; toggle.textContent=game.enabled?"Disable":"Enable"; toggle.addEventListener("click",()=>setEnabled(game,!game.enabled));
    const remove=document.createElement("button"); remove.type="button"; remove.className="danger"; remove.textContent="Remove"; remove.addEventListener("click",()=>removeGame(game));
    const count=downloads.get(game.path)??0; actions.append(edit,toggle,remove); row.append(cell(game.title),cell(game.filename),cell(game.publisher),cell(count,count),actions); return row;
  }));
  refreshSortableTables();
}

async function api(path, options={}) {
  const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...options.headers}});
  const data=await response.json(); if(!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`); return data;
}

async function load() {
  elements.notice.textContent="Loading…";
  try { dashboard=await api("/api/admin/dashboard"); render(); elements.notice.textContent=""; }
  catch(error) { elements.notice.textContent=error.message; }
}

function openDialog(game=null) {
  elements["original-path"].value=game?.path ?? ""; elements.title.value=game?.title ?? ""; elements.filename.value=game?.filename ?? "";
  elements.publisher.replaceChildren(...dashboard.publishers.map((value)=>new Option(value,value)),new Option("+ Add new publisher…","__new__"));
  elements.publisher.value=game?.publisher ?? dashboard.publishers[0];
  elements["new-publisher-label"].hidden=true; elements["new-publisher"].required=false; elements["new-publisher"].value="";
  elements["dialog-notice"].textContent=""; elements["save-game"].disabled=false; elements["save-game"].textContent="Save game";
  elements["uef-file"].required=!game; elements["file-label"].hidden=Boolean(game); elements["dialog-title"].textContent=game?"Edit game":"Add game";
  elements["game-dialog"].showModal();
}

async function fileBase64(file) {
  if(!file) return undefined; const bytes=new Uint8Array(await file.arrayBuffer()); let binary="";
  for(let offset=0;offset<bytes.length;offset+=0x8000) binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(binary);
}

async function removeGame(game) {
  if(!confirm(`Remove ${game.title} and its UEF file?`)) return;
  try { await api("/api/admin/games",{method:"DELETE",body:JSON.stringify({path:game.path})}); await load(); elements.notice.textContent=`Removed ${game.title}`; }
  catch(error) { elements.notice.textContent=error.message; }
}

async function setEnabled(game,enabled) {
  try { await api("/api/admin/games/status",{method:"PATCH",body:JSON.stringify({path:game.path,enabled})}); await load(); elements.notice.textContent=`${game.title} ${enabled?"enabled":"disabled"}`; }
  catch(error) { elements.notice.textContent=error.message; }
}

elements["game-form"].addEventListener("submit",async(event)=>{
  event.preventDefault(); const originalPath=elements["original-path"].value;
  elements["dialog-notice"].textContent="Saving…"; elements["save-game"].disabled=true; elements["save-game"].textContent="Saving…";
  try {
    let publisher=elements.publisher.value;
    if(publisher==="__new__") ({publisher}=await api("/api/admin/publishers",{method:"POST",body:JSON.stringify({name:elements["new-publisher"].value})}));
    const body={originalPath,title:elements.title.value,filename:elements.filename.value,publisher};
    if(!originalPath) body.uefBase64=await fileBase64(elements["uef-file"].files[0]);
    await api("/api/admin/games",{method:originalPath?"PATCH":"POST",body:JSON.stringify(body)}); elements["game-dialog"].close(); await load(); elements.notice.textContent=originalPath?"Game updated":"Game added";
  }
  catch(error) { elements["dialog-notice"].textContent=error.message; }
  finally { elements["save-game"].disabled=false; elements["save-game"].textContent="Save game"; }
});
elements.publisher.addEventListener("change",()=>{const adding=elements.publisher.value==="__new__";elements["new-publisher-label"].hidden=!adding;elements["new-publisher"].required=adding;if(adding)elements["new-publisher"].focus()});
elements["uef-file"].addEventListener("change",()=>{const file=elements["uef-file"].files[0];if(!file)return;const uploadName=file.name.replace(/\.gz$/i,"");if(!elements.filename.value)elements.filename.value=uploadName;const lower=uploadName.toLowerCase();const match=dashboard.publishers.find((publisher)=>{const name=publisher.toLowerCase();return lower.startsWith(name)&&["-","_"," "].includes(lower[name.length])});if(match)elements.publisher.value=match});
elements["add-game"].addEventListener("click",()=>openDialog()); elements.refresh.addEventListener("click",load); elements["game-search"].addEventListener("input",renderGames);
elements.cancel.addEventListener("click",()=>elements["game-dialog"].close()); elements["close-dialog"].addEventListener("click",()=>elements["game-dialog"].close());
await load();
