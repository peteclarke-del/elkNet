import { refreshSortableTables } from "/admin/admin-sort.js";

const elements=Object.fromEntries([...document.querySelectorAll("[id]")].map((element)=>[element.id,element]));
const formatDate=(value)=>value?new Date(value).toLocaleString():"—";
const formatBytes=(value)=>new Intl.NumberFormat(undefined,{style:"unit",unit:"megabyte",maximumFractionDigits:2}).format((value??0)/1_000_000);
function cell(value,sortValue){const td=document.createElement("td");td.textContent=value??"—";if(sortValue!==undefined&&sortValue!==null)td.dataset.sortValue=sortValue;return td}
function metadata(label,value){const wrapper=document.createElement("div");const term=document.createElement("dt");const detail=document.createElement("dd");term.textContent=label;detail.textContent=value??"—";wrapper.append(term,detail);return wrapper}

function showDownloads(host) {
  elements["dialog-host"].textContent=host.id;
  elements["dialog-summary"].textContent=`${host.downloads} downloads across ${host.uniqueFiles} files`;
  elements["host-metadata"].replaceChildren(
    metadata("Identifier type",host.identifierType),metadata("IP address",host.ip),metadata("MAC address",host.mac),metadata("Downloads",host.downloads),
    metadata("Unique files",host.uniqueFiles),metadata("Transferred",formatBytes(host.bytes)),metadata("First seen",formatDate(host.firstSeen)),metadata("Last seen",formatDate(host.lastSeen)),
    metadata("Latest file",host.lastFile),metadata("User agent",host.userAgent),metadata("Forwarded address",host.forwardedFor),metadata("Remote address",host.remoteAddress),
    metadata("Language",host.acceptLanguage)
  );
  const files=host.fileDownloads??[];
  elements["host-files"].replaceChildren(...files.map((file)=>{
    const row=document.createElement("tr");
    row.append(cell(file.path),cell(file.downloads,file.downloads),cell(file.bytes===null?null:formatBytes(file.bytes),file.bytes),cell(formatDate(file.firstDownloaded),file.firstDownloaded),cell(formatDate(file.lastDownloaded),file.lastDownloaded));
    return row;
  }));
  if(!files.length){const row=document.createElement("tr");const td=cell("No per-file history is available for this host");td.colSpan=5;row.append(td);elements["host-files"].append(row)}
  refreshSortableTables(elements["downloads-dialog"]);
  elements["downloads-dialog"].showModal();
}

try {
  const response=await fetch("/api/admin/dashboard");
  const dashboard=await response.json();
  if(!response.ok)throw new Error(dashboard.error??`HTTP ${response.status}`);
  const hosts=dashboard.stats.devices;
  elements["host-count"].textContent=hosts.length;
  elements["download-count"].textContent=dashboard.stats.totalDownloads;
  elements["transfer-count"].textContent=formatBytes(hosts.reduce((total,host)=>total+(host.bytes??0),0));
  elements.hosts.replaceChildren(...hosts.map((host)=>{
    const row=document.createElement("tr"); row.className="clickable-row"; row.tabIndex=0; row.setAttribute("aria-label",`View downloads for ${host.id}`);
    row.append(cell(host.id),cell(host.identifierType),cell(host.downloads,host.downloads),cell(host.uniqueFiles,host.uniqueFiles),cell(formatBytes(host.bytes),host.bytes),cell(formatDate(host.firstSeen),host.firstSeen),cell(formatDate(host.lastSeen),host.lastSeen),cell(host.lastFile),cell(host.userAgent),cell(host.forwardedFor),cell(host.remoteAddress),cell(host.acceptLanguage));
    row.addEventListener("click",()=>showDownloads(host));
    row.addEventListener("keydown",(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();showDownloads(host)}});
    return row;
  }));
  if(!hosts.length){const row=document.createElement("tr");const td=cell("No hosts recorded yet");td.colSpan=12;row.append(td);elements.hosts.append(row)}
  refreshSortableTables();
  elements.notice.textContent="";
} catch(error) {
  elements.notice.textContent=error.message;
}

elements["close-dialog"].addEventListener("click",()=>elements["downloads-dialog"].close());
