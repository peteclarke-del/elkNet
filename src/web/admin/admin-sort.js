const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:"base"});

function valueFor(cell,type) {
  const raw=cell?.dataset.sortValue??cell?.textContent.trim()??"";
  if(type==="number") { const value=Number(raw); return Number.isNaN(value)?Number.NEGATIVE_INFINITY:value; }
  if(type==="date") { const value=Date.parse(raw); return Number.isNaN(value)?Number.NEGATIVE_INFINITY:value; }
  return raw;
}

function applySort(table) {
  const index=Number(table.dataset.sortIndex);
  const direction=table.dataset.sortDirection;
  const headings=[...table.querySelectorAll("thead th")];
  const type=headings[index]?.dataset.sortType??"text";
  const body=table.tBodies[0];
  if(!body||!headings[index])return;
  const rows=[...body.rows];
  rows.sort((left,right)=>{
    const a=valueFor(left.cells[index],type); const b=valueFor(right.cells[index],type);
    const order=typeof a==="number"?a-b:collator.compare(a,b);
    return direction==="asc"?order:-order;
  });
  body.append(...rows);
  headings.forEach((heading,headingIndex)=>{
    const button=heading.querySelector(".table-sort-button"); if(!button)return;
    const active=headingIndex===index; button.setAttribute("aria-pressed",String(active));
    button.querySelector(".table-sort-arrow").textContent=active?(direction==="asc"?"↑":"↓"):"";
  });
}

export function refreshSortableTables(root=document) {
  for(const table of root.querySelectorAll("table")) {
    const headings=[...table.querySelectorAll("thead th")];
    headings.forEach((heading,index)=>{
      if(!heading.textContent.trim()||heading.dataset.sortable==="false"||heading.querySelector(".table-sort-button"))return;
      const label=heading.textContent.trim(); const button=document.createElement("button"); button.type="button"; button.className="table-sort-button";
      const text=document.createElement("span"); text.textContent=label; const arrow=document.createElement("span"); arrow.className="table-sort-arrow"; arrow.setAttribute("aria-hidden","true");
      button.append(text,arrow); button.addEventListener("click",()=>{const current=Number(table.dataset.sortIndex);if(current===index)table.dataset.sortDirection=table.dataset.sortDirection==="asc"?"desc":"asc";else{table.dataset.sortIndex=String(index);table.dataset.sortDirection="asc"}applySort(table)}); heading.replaceChildren(button);
    });
    if(table.dataset.sortIndex===undefined)table.dataset.sortIndex=table.dataset.defaultSort??"0";
    if(!table.dataset.sortDirection)table.dataset.sortDirection=table.dataset.defaultDirection??"asc";
    applySort(table);
  }
}
