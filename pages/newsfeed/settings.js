// Settings for the Newsfeed Projector. They live in the toolkit's shared settings under "newsfeedProjector",
// and the toolkit menu is where they are edited, so this page only reads them.
export const AUDIENCE_LABELS = {
  all: "All news",
  staff: "Staff only",
  community: "Students & parents",
  students: "Students only"
};

export async function getSettings() {
  return { ...(await CompassToolkit.getSettings()).newsfeedProjector };
}

// Manual audience overrides live in local storage:
// { [newsFeedItemId]: "staff" | "community" | "hidden" }
const OVERRIDES_KEY = CompassToolkit.DATA_KEYS.newsfeedOverrides;

export async function getOverrides() {
  return (await chrome.storage.local.get(OVERRIDES_KEY))[OVERRIDES_KEY] || {};
}

export async function setOverride(newsFeedItemId, value) {
  const overrides = await getOverrides();
  if (!value) delete overrides[newsFeedItemId];
  else overrides[newsFeedItemId] = value;
  await chrome.storage.local.set({ [OVERRIDES_KEY]: overrides });
}
