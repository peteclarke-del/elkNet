const search = document.querySelector("#search");
const status = document.querySelector("#status");
const titleList = document.querySelector("#titles");

let catalogue = [];
let sortKey = "title";
let sortDirection = "asc";
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortValue(game, key) {
  if (key === "enabled") return game.enabled ? 1 : 0;
  return game[key] ?? "";
}

function updateSortHeadings() {
  for (const button of document.querySelectorAll(".sort-button")) {
    const active = button.dataset.sort === sortKey;
    button.setAttribute("aria-pressed", String(active));
    button.querySelector(".sort-arrow").textContent = active ? (sortDirection === "asc" ? "↑" : "↓") : "";
    button.title = active
      ? `Sorted ${sortDirection === "asc" ? "ascending" : "descending"}; click to reverse`
      : `Sort by ${button.textContent.trim()}`;
  }
}

function render(query = "") {
  const needle = query.trim().toLocaleLowerCase();
  const matches = catalogue.filter(({ title, filename, publisher }) =>
    `${title} ${filename} ${publisher}`.toLocaleLowerCase().includes(needle)
  ).sort((left, right) => {
    const a = sortValue(left, sortKey);
    const b = sortValue(right, sortKey);
    const order = typeof a === "number" ? a - b : collator.compare(a, b);
    return (sortDirection === "asc" ? order : -order) || collator.compare(left.title, right.title);
  });

  status.textContent = catalogue.length
    ? `${matches.length} of ${catalogue.length} titles`
    : "The catalogue is ready for its first UEF files.";

  titleList.replaceChildren(
    ...matches.map(({ title, publisher, path, enabled }) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const source = document.createElement("small");
      const download = document.createElement(enabled ? "a" : "span");
      name.textContent = title;
      source.textContent = publisher;
      download.className = `download${enabled ? "" : " disabled"}`;
      download.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="11" r="2.2"/><circle cx="16" cy="11" r="2.2"/><path d="M7 16h10l1 3H6l1-3Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
      if (enabled) {
        download.href = `/uefarchive/${path.split("/").map(encodeURIComponent).join("/")}`;
        download.download = "";
        download.setAttribute("aria-label", `Download ${title} tape image`);
        download.title = `Download ${title} tape image`;
      } else {
        download.setAttribute("aria-disabled", "true");
        download.setAttribute("aria-label", `${title} is disabled`);
        download.title = `${title} is disabled`;
      }
      item.append(name, source, download);
      return item;
    })
  );
}

try {
  const response = await fetch("/catalog.json");
  if (!response.ok) throw new Error(`Catalogue returned ${response.status}`);
  catalogue = await response.json();
  render();
} catch (error) {
  status.textContent = "The catalogue could not be loaded.";
  console.error(error);
}

search.addEventListener("input", () => render(search.value));
for (const button of document.querySelectorAll(".sort-button")) {
  button.addEventListener("click", () => {
    if (sortKey === button.dataset.sort) sortDirection = sortDirection === "asc" ? "desc" : "asc";
    else { sortKey = button.dataset.sort; sortDirection = "asc"; }
    updateSortHeadings();
    render(search.value);
  });
}
updateSortHeadings();
