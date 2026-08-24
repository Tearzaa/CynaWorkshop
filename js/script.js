"use strict";

/*
  CYNA MODEL WORKS
  Cross-device media edition.

  IMPORTANT:
  1. Put your Supabase URL and anon key below.
  2. Create a PUBLIC storage bucket named: portfolio-media
  3. Create the site_config table/policies described below the code.
  4. If Supabase is not configured, the site still works locally with IndexedDB.
*/

const SUPABASE_URL = "https://kewqncwoqvcvhqwhqxjx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BpO9CYOrv_K0SrEL9M28IQ_fJ_pkYTF";
const STORAGE_BUCKET = "portfolio-media";
const SITE_CONFIG_ID = 1;

const ADMIN_PASSWORD = "@tasnim020821";

const DB_NAME = "CynaModelWorksDB";
const DB_VERSION = 2;
const MEDIA_STORE = "media";
const SETTINGS_STORE = "settings";

let db = null;
let editorMode = false;
let hasDrafts = false;
let projects = [];
let viewerProjectId = null;
let viewerIndex = 0;
let supabaseClient = null;

const cloudEnabled =
    typeof window.supabase !== "undefined" &&
    SUPABASE_URL.startsWith("https://") &&
    SUPABASE_ANON_KEY.length > 20;

if (cloudEnabled) {
    try {
        supabaseClient = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY
        );

        console.log("Supabase connected");
    } catch (error) {
        console.error("Supabase setup failed:", error);
        supabaseClient = null;
    }
} else {
    console.warn("Supabase library or credentials unavailable");
}

/* =========================================================
   SAFE STORAGE HELPERS
========================================================= */

function safeGet(key, fallback = null) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch (error) {
        console.warn("localStorage read blocked:", error);
        return fallback;
    }
}

function safeSet(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn("localStorage write blocked:", error);
        return false;
    }
}

function safeRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch (_) {}
}

/* =========================================================
   INDEXED DB
   Local IndexedDB is ONLY the draft/cache layer.
   Published media is uploaded to Supabase.
========================================================= */

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB is unavailable."));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = event => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(MEDIA_STORE)) {
                database.createObjectStore(MEDIA_STORE, {
                    keyPath: "id"
                });
            }

            if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
                database.createObjectStore(SETTINGS_STORE, {
                    keyPath: "id"
                });
            }
        };

        request.onsuccess = event => {
            db = event.target.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };

        request.onerror = () => {
            reject(
                request.error ||
                new Error("Unable to open IndexedDB.")
            );
        };
    });
}

function idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("IndexedDB is not ready."));
            return;
        }

        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const request = store.put(value);

        request.onsuccess = () => resolve(value.id);
        request.onerror = () => reject(request.error);
    });
}

function idbGet(storeName, id) {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve(null);
            return;
        }

        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

function idbDelete(storeName, id) {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve();
            return;
        }

        const tx = db.transaction(storeName, "readwrite");
        const request = tx.objectStore(storeName).delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function makeId(prefix = "id") {
    if (window.crypto && crypto.randomUUID) {
        return prefix + "_" + crypto.randomUUID();
    }

    return (
        prefix +
        "_" +
        Date.now() +
        "_" +
        Math.random().toString(36).slice(2)
    );
}

async function saveDraftBlob(blob, name, type) {
    const id = makeId("media");

    await idbPut(MEDIA_STORE, {
        id,
        blob,
        name: name || "media",
        type: type || blob.type || "application/octet-stream"
    });

    return id;
}

async function getDraftBlob(id) {
    const record = await idbGet(MEDIA_STORE, id);
    return record || null;
}

async function deleteDraftBlob(id) {
    if (id) {
        await idbDelete(MEDIA_STORE, id);
    }
}

async function saveDraftLogo(file) {
    const id = makeId("logo");

    await idbPut(MEDIA_STORE, {
        id,
        blob: file,
        name: file.name || "logo",
        type: file.type || "image/png"
    });

    return id;
}

/* =========================================================
   DEFAULT DATA
========================================================= */

function defaultProjects() {
    return [
        {
            id: "project_1",
            title: "Sinanju Custom",
            category: "gundam",
            description:
                "Custom Gunpla project focused on surface cleanup and detailing.",
            media: []
        },
        {
            id: "project_2",
            title: "RG Sazabi",
            category: "gundam",
            description:
                "High-detail build prepared for display.",
            media: []
        },
        {
            id: "project_3",
            title: "Humanoid Custom",
            category: "humanoids",
            description:
                "Custom humanoid scale model project.",
            media: []
        }
    ];
}

/* =========================================================
   LOCAL SITE STATE
========================================================= */

function loadLocalState() {
    let savedProjects = safeGet("cynaProjects");

    if (savedProjects) {
        try {
            projects = JSON.parse(savedProjects);
        } catch (_) {
            projects = defaultProjects();
        }
    } else {
        projects = defaultProjects();
    }

    const settingsRaw = safeGet("cynaSettings");

    let settings = {
        background: "#121212",
        logo: null
    };

    if (settingsRaw) {
        try {
            settings = {
                ...settings,
                ...JSON.parse(settingsRaw)
            };
        } catch (_) {}
    }

    return settings;
}

function saveLocalProjects() {
    return safeSet(
        "cynaProjects",
        JSON.stringify(projects)
    );
}

function saveLocalSettings(settings) {
    return safeSet(
        "cynaSettings",
        JSON.stringify(settings)
    );
}

function saveTextContent() {
    const texts = {};

    document
        .querySelectorAll("[data-editable]")
        .forEach((element, index) => {
            texts[index] = element.innerHTML;
        });

    safeSet(
        "cynaTextContent",
        JSON.stringify(texts)
    );
}

function loadTextContent() {
    const raw = safeGet("cynaTextContent");

    if (!raw) return;

    try {
        const texts = JSON.parse(raw);

        document
            .querySelectorAll("[data-editable]")
            .forEach((element, index) => {
                if (
                    Object.prototype.hasOwnProperty.call(
                        texts,
                        index
                    )
                ) {
                    element.innerHTML = texts[index];
                }
            });
    } catch (error) {
        console.warn("Text hydration failed:", error);
    }
}

/* =========================================================
   CLOUD HELPERS
========================================================= */

async function getCloudConfig() {
    if (!supabaseClient) return null;

    const { data, error } =
        await supabaseClient
            .from("site_config")
            .select("data")
            .eq("id", SITE_CONFIG_ID)
            .maybeSingle();

    if (error) {
        throw error;
    }

    return data ? data.data : null;
}

async function saveCloudConfig(config) {
    if (!supabaseClient) {
        throw new Error(
            "Supabase is not configured."
        );
    }

    const { error } =
        await supabaseClient
            .from("site_config")
            .upsert({
                id: SITE_CONFIG_ID,
                data: config,
                updated_at: new Date().toISOString()
            });

    if (error) {
        throw error;
    }
}

async function uploadCloudFile(file, folder) {
    if (!supabaseClient) {
        throw new Error(
            "Supabase is not configured."
        );
    }

    const extension =
        (file.name || "file")
            .split(".")
            .pop()
            .toLowerCase();

    const path =
        folder +
        "/" +
        makeId("file") +
        "." +
        extension;

    const { error } =
        await supabaseClient
            .storage
            .from(STORAGE_BUCKET)
            .upload(
                path,
                file,
                {
                    cacheControl: "3600",
                    upsert: false,
                    contentType:
                        file.type ||
                        "application/octet-stream"
                }
            );

    if (error) {
        throw error;
    }

    const { data } =
        supabaseClient
            .storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(path);

    return {
        path,
        url: data.publicUrl,
        type: file.type,
        name: file.name
    };
}

async function deleteCloudFile(path) {
    if (!supabaseClient || !path) return;

    const { error } =
        await supabaseClient
            .storage
            .from(STORAGE_BUCKET)
            .remove([path]);

    if (error) {
        console.warn(
            "Cloud delete failed:",
            error
        );
    }
}

/* =========================================================
   HYDRATION
========================================================= */

async function hydrateSite() {
    const localSettings = loadLocalState();

    document.documentElement.style.setProperty(
        "--bg",
        localSettings.background ||
        "#121212"
    );

    const picker =
        document.getElementById(
            "backgroundPicker"
        );

    if (picker) {
        picker.value =
            localSettings.background ||
            "#121212";
    }

    if (localSettings.logo) {
        await setLogoFromState(
            localSettings.logo
        );
    } else {
        document.getElementById("siteLogo").src =
            createDefaultLogo();
    }

    loadTextContent();

    if (!supabaseClient) {
        setStorageStatus(
            "Local draft storage ready. Configure Supabase for cross-device publishing."
        );
        return;
    }

    try {
        const cloud = await getCloudConfig();

        if (cloud) {
            if (Array.isArray(cloud.projects)) {
                projects = cloud.projects;
                saveLocalProjects();
            }

            if (cloud.background) {
                document.documentElement
                    .style
                    .setProperty(
                        "--bg",
                        cloud.background
                    );

                if (picker) {
                    picker.value =
                        cloud.background;
                }
            }

            if (cloud.texts) {
                applyCloudTexts(
                    cloud.texts
                );
            }

            if (cloud.logo) {
                document.getElementById(
                    "siteLogo"
                ).src = cloud.logo;
            }

            const mergedSettings = {
                ...localSettings,
                background:
                    cloud.background ||
                    localSettings.background,
                logo:
                    cloud.logo ||
                    localSettings.logo
            };

            saveLocalSettings(
                mergedSettings
            );

            setStorageStatus(
                "☁ Published cloud content loaded. This version is shared across devices."
            );
        } else {
            setStorageStatus(
                "☁ Cloud connected. No published configuration exists yet."
            );
        }
    } catch (error) {
        console.error(
            "Cloud hydration failed:",
            error
        );

        setStorageStatus(
            "Cloud unavailable. Using this device's saved content."
        );
    }
}

function applyCloudTexts(texts) {
    document
        .querySelectorAll("[data-editable]")
        .forEach((element, index) => {
            if (
                Object.prototype.hasOwnProperty.call(
                    texts,
                    index
                )
            ) {
                element.innerHTML =
                    texts[index];
            }
        });
}

async function setLogoFromState(logoState) {
    const logo =
        document.getElementById(
            "siteLogo"
        );

    if (!logo) return;

    if (
        typeof logoState === "string"
    ) {
        logo.src = logoState;
        updateFaviconFromLogo(logoState);
        return;
    }

    if (
        logoState &&
        logoState.url
    ) {
        logo.src = logoState.url;
        updateFaviconFromLogo(logoState.url);
        return;
    }

    if (
        logoState &&
        logoState.localId
    ) {
        const record =
            await getDraftBlob(
                logoState.localId
            );

        if (record) {
            logo.src =
                URL.createObjectURL(
                    record.blob
                );
            updateFaviconFromLogo(logo.src);
        }
    }
}

function setStorageStatus(text) {
    const element =
        document.getElementById(
            "storageStatus"
        );

    if (element) {
        element.textContent = text;
    }
}

/* =========================================================
   DEFAULT LOGO
========================================================= */

function createDefaultLogo() {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg"
             width="200"
             height="200"
             viewBox="0 0 200 200">
            <rect
                width="200"
                height="200"
                fill="#0d0d0d"
            />
            <path
                d="M35 155 L65 45 L100 95 L135 45 L165 155 L130 130 L100 170 L70 130 Z"
                fill="none"
                stroke="#ff6600"
                stroke-width="8"
            />
            <circle
                cx="100"
                cy="105"
                r="12"
                fill="#ff6600"
            />
        </svg>
    `;

    return (
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(svg)
    );
}

/* =========================================================
   DRAFT
========================================================= */

function markDraft() {
    hasDrafts = true;

    document
        .getElementById("publishBar")
        .classList
        .add("visible");
}

/* =========================================================
   PUBLISH
   Local draft media is uploaded to Supabase here.
========================================================= */

async function publishChanges() {
    if (!editorMode) return;

    saveTextContent();
    saveLocalProjects();

    const publishButton =
        document.getElementById(
            "publishBtn"
        );

    publishButton.disabled = true;
    publishButton.textContent =
        "PUBLISHING...";

    try {
        const settingsRaw =
            safeGet("cynaSettings");

        let settings = {
            background:
                getComputedStyle(
                    document.documentElement
                )
                    .getPropertyValue(
                        "--bg"
                    )
                    .trim() ||
                "#121212",
            logo: null
        };

        if (settingsRaw) {
            try {
                settings = {
                    ...settings,
                    ...JSON.parse(
                        settingsRaw
                    )
                };
            } catch (_) {}
        }

        settings.background =
            getComputedStyle(
                document.documentElement
            )
                .getPropertyValue(
                    "--bg"
                )
                .trim() ||
            "#121212";

        /* -----------------------------------------
           Publish logo
        ----------------------------------------- */

        const logo =
            document.getElementById(
                "siteLogo"
            );

        if (
            settings.logo &&
            settings.logo.localId
        ) {
            const record =
                await getDraftBlob(
                    settings.logo.localId
                );

            if (record) {
                if (
                    supabaseClient
                ) {
                    const uploaded =
                        await uploadCloudFile(
                            new File(
                                [record.blob],
                                record.name,
                                {
                                    type:
                                        record.type
                                }
                            ),
                            "branding"
                        );

                    settings.logo = {
                        url:
                            uploaded.url,
                        path:
                            uploaded.path
                    };

                    logo.src =
                        uploaded.url;

                    await deleteDraftBlob(
                        record.id
                    );
                }
            }
        }

        /* -----------------------------------------
           Publish all local draft media
        ----------------------------------------- */

        for (
            const project
            of projects
        ) {
            for (
                let i = 0;
                i < project.media.length;
                i++
            ) {
                const media =
                    project.media[i];

                if (
                    media.localId &&
                    supabaseClient
                ) {
                    const record =
                        await getDraftBlob(
                            media.localId
                        );

                    if (!record) {
                        throw new Error(
                            "A draft media file could not be found: " +
                            media.name
                        );
                    }

                    const file =
                        new File(
                            [record.blob],
                            record.name,
                            {
                                type:
                                    record.type
                            }
                        );

                    const uploaded =
                        await uploadCloudFile(
                            file,
                            "projects/" +
                            project.id
                        );

                    project.media[i] = {
                        url:
                            uploaded.url,
                        path:
                            uploaded.path,
                        type:
                            uploaded.type,
                        name:
                            uploaded.name
                    };

                    await deleteDraftBlob(
                        record.id
                    );
                }
            }
        }

        const texts = {};

        document
            .querySelectorAll(
                "[data-editable]"
            )
            .forEach(
                (element, index) => {
                    texts[index] =
                        element.innerHTML;
                }
            );

        /* -----------------------------------------
           Cloud publish
        ----------------------------------------- */

        if (supabaseClient) {
            await saveCloudConfig({
                background:
                    settings.background,

                logo:
                    settings.logo
                    ? (
                        settings.logo.url ||
                        null
                    )
                    : null,

                texts,

                projects
            });

            setStorageStatus(
                "☁ Published successfully. Content is now shared across devices."
            );
        } else {
            setStorageStatus(
                "Local changes saved. Configure Supabase to make them visible on other devices."
            );
        }

        saveLocalProjects();

        saveLocalSettings({
            background:
                settings.background,
            logo:
                settings.logo
        });

        hasDrafts = false;

        document
            .getElementById(
                "publishBar"
            )
            .classList
            .remove(
                "visible"
            );

        alert(
            supabaseClient
                ? "Success! Your changes have been pushed live!"
                : "Saved on this device. Supabase is not configured, so other devices will not see these changes yet."
        );

        await renderPortfolio(
            getActiveFilter()
        );
    } catch (error) {
        console.error(
            "Publish failed:",
            error
        );

        alert(
            "Unable to publish changes.\n\n" +
            error.message
        );
    } finally {
        publishButton.disabled = false;
        publishButton.textContent =
            "PUBLISH CHANGES";
    }
}

/* =========================================================
   EDITOR ACCESS
========================================================= */

function requestEditorAccess() {
    if (editorMode) {
        editorMode = false;

        document.body
            .classList
            .remove(
                "editor-mode"
            );

        document
            .getElementById(
                "editorToggle"
            )
            .textContent =
            "Editor Side";

        updateEditableState();

        renderPortfolio(
            getActiveFilter()
        );

        return;
    }

    const password =
        prompt(
            "Enter Admin Password:"
        );

    if (
        password ===
        ADMIN_PASSWORD
    ) {
        editorMode = true;

        document.body
            .classList
            .add(
                "editor-mode"
            );

        document
            .getElementById(
                "editorToggle"
            )
            .textContent =
            "Exit Editor";

        updateEditableState();

        renderPortfolio(
            getActiveFilter()
        );
    } else {
        alert(
            "Access Denied"
        );
    }
}

function updateEditableState() {
    document
        .querySelectorAll(
            "[data-editable]"
        )
        .forEach(element => {
            element.contentEditable =
                editorMode
                    ? "true"
                    : "false";
        });
}


/* =========================================================
   FAVICON SYNC WITH LOGO
========================================================= */

function updateFaviconFromLogo(url){
    let icon = document.querySelector("link[rel='icon']");
    if(!icon){
        icon = document.createElement("link");
        icon.rel = "icon";
        document.head.appendChild(icon);
    }
    icon.href = url + "?v=" + Date.now();
}

/* =========================================================
   LOGO UPLOAD
========================================================= */

document
    .getElementById(
        "logoInput"
    )
    .addEventListener(
        "change",
        async event => {
            const file =
                event.target.files[0];

            if (!file) return;

            if (
                !file.type.startsWith(
                    "image/"
                )
            ) {
                alert(
                    "Please select an image."
                );
                return;
            }

            try {
                const localId =
                    await saveDraftLogo(
                        file
                    );

                const logo =
                    document.getElementById(
                        "siteLogo"
                    );

                const logoURL =
                    URL.createObjectURL(
                        file
                    );

                logo.src = logoURL;

                updateFaviconFromLogo(logoURL);

                const currentRaw =
                    safeGet(
                        "cynaSettings"
                    );

                let settings = {
                    background:
                        "#121212",
                    logo: null
                };

                if (currentRaw) {
                    try {
                        settings = {
                            ...settings,
                            ...JSON.parse(
                                currentRaw
                            )
                        };
                    } catch (_) {}
                }

                settings.logo = {
                    localId,
                    name: file.name,
                    type: file.type
                };

                saveLocalSettings(
                    settings
                );

                markDraft();
            } catch (error) {
                console.error(error);

                alert(
                    "Logo upload failed:\n\n" +
                    error.message
                );
            }
        }
    );

/* =========================================================
   BACKGROUND
========================================================= */

document
    .getElementById(
        "backgroundPicker"
    )
    .addEventListener(
        "input",
        event => {
            document.documentElement
                .style
                .setProperty(
                    "--bg",
                    event.target.value
                );

            markDraft();
        }
    );

/* =========================================================
   TEXT EDITING
========================================================= */

document.addEventListener(
    "input",
    event => {
        if (
            editorMode &&
            event.target.matches(
                "[data-editable]"
            )
        ) {
            markDraft();
        }
    }
);

/* =========================================================
   MEDIA HELPERS
========================================================= */

async function createMediaElement(
    media
) {
    let sourceUrl = null;
    let type =
        media.type ||
        "";

    if (media.url) {
        sourceUrl =
            media.url;
    } else if (media.localId) {
        const record =
            await getDraftBlob(
                media.localId
            );

        if (!record) {
            const missing =
                document.createElement(
                    "div"
                );

            missing.style.cssText =
                "display:grid;place-items:center;width:100%;height:100%;color:#555;";

            missing.textContent =
                "Missing media";

            return missing;
        }

        sourceUrl =
            URL.createObjectURL(
                record.blob
            );

        type =
            record.type ||
            type;
    }

    if (
        type.startsWith(
            "video/"
        )
    ) {
        const video =
            document.createElement(
                "video"
            );

        video.src =
            sourceUrl;

        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.controls = false;

        return video;
    }

    const image =
        document.createElement(
            "img"
        );

    image.src =
        sourceUrl;

    image.alt =
        media.name ||
        "Model project";

    return image;
}

/* =========================================================
   RENDER PORTFOLIO
========================================================= */

async function renderPortfolio(
    filter = "all"
) {
    const grid =
        document.getElementById(
            "portfolioGrid"
        );

    grid.innerHTML = "";

    const filtered =
        projects.filter(
            project =>
                filter === "all" ||
                project.category ===
                filter
        );

    if (!filtered.length) {
        grid.innerHTML = `
            <div class="empty-projects">
                No projects in this category yet.
            </div>
        `;
        return;
    }

    for (
        const project
        of filtered
    ) {
        const card =
            await createProjectCard(
                project
            );

        grid.appendChild(
            card
        );
    }
}

/* =========================================================
   PROJECT CARD
========================================================= */

async function createProjectCard(
    project
) {
    const card =
        document.createElement(
            "article"
        );

    card.className =
        "project-card";

    card.dataset.category =
        project.category;

    const thumbnail =
        document.createElement(
            "div"
        );

    thumbnail.className =
        "project-thumbnail";

    const track =
        document.createElement(
            "div"
        );

    track.className =
        "thumbnail-track";

    if (
        project.media &&
        project.media.length
    ) {
        const first =
            await createMediaElement(
                project.media[0]
            );

        const wrap =
            document.createElement(
                "div"
            );

        wrap.className =
            "thumbnail-item";

        wrap.appendChild(
            first
        );

        track.appendChild(
            wrap
        );
    } else {
        track.innerHTML = `
            <div
                class="thumbnail-item"
                style="
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    color:#555;
                "
            >
                NO MEDIA
            </div>
        `;
    }

    thumbnail.appendChild(
        track
    );

    if (
        project.media &&
        project.media.length
    ) {
        const count =
            document.createElement(
                "div"
            );

        count.className =
            "media-count";

        count.textContent =
            `${project.media.length} MEDIA`;

        thumbnail.appendChild(
            count
        );

        const strip =
            document.createElement(
                "div"
            );

        strip.className =
            "mini-strip";

        project.media
            .slice(0, 3)
            .forEach(
                (media, index) => {
                    createMediaElement(
                        media
                    ).then(
                        element => {
                            const mini =
                                document.createElement(
                                    "div"
                                );

                            mini.className =
                                "mini-thumb";

                            mini.appendChild(
                                element
                            );

                            mini.addEventListener(
                                "click",
                                event => {
                                    event.stopPropagation();

                                    openViewer(
                                        project.id,
                                        index
                                    );
                                }
                            );

                            strip.appendChild(
                                mini
                            );
                        }
                    );
                }
            );

        thumbnail.appendChild(
            strip
        );
    }

    card.appendChild(
        thumbnail
    );

    const info =
        document.createElement(
            "div"
        );

    info.className =
        "project-info";

    const category =
        document.createElement(
            "div"
        );

    category.className =
        "project-category";

    category.textContent =
        project.category;

    const title =
        document.createElement(
            "div"
        );

    title.className =
        "project-title";

    title.textContent =
        project.title;

    const description =
        document.createElement(
            "div"
        );

    description.className =
        "project-description";

    description.textContent =
        project.description ||
        "";

    info.append(
        category,
        title,
        description
    );

    card.appendChild(
        info
    );

    if (
        editorMode
    ) {
        title.contentEditable =
            "true";

        title.addEventListener(
            "input",
            () => {
                project.title =
                    title.textContent;

                markDraft();
            }
        );

        description.contentEditable =
            "true";

        description.addEventListener(
            "input",
            () => {
                project.description =
                    description.textContent;

                markDraft();
            }
        );
    }

    card.addEventListener(
        "click",
        () => {
            if (
                project.media &&
                project.media.length
            ) {
                openViewer(
                    project.id,
                    0
                );
            }
        }
    );

    /* -----------------------------------------
       ADMIN CONTROLS
    ----------------------------------------- */

    const admin =
        document.createElement(
            "div"
        );

    admin.className =
        "admin-controls";

    admin.innerHTML = `
        <div class="admin-media-buttons">

            <label class="btn file-btn">
                <span>
                    + Add Media
                </span>

                <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                >
            </label>

            <button
                class="btn btn-danger delete-project"
                type="button"
            >
                Delete Project
            </button>

        </div>

        <div class="media-list"></div>
    `;

    const addInput =
        admin.querySelector(
            'input[type="file"]'
        );

    addInput.addEventListener(
        "change",
        async event => {
            const files =
                Array.from(
                    event.target.files
                );

            for (
                const file
                of files
            ) {
                if (
                    !file.type.startsWith(
                        "image/"
                    ) &&
                    !file.type.startsWith(
                        "video/"
                    )
                ) {
                    continue;
                }

                const localId =
                    await saveDraftBlob(
                        file,
                        file.name,
                        file.type
                    );

                project.media.push({
                    localId,
                    type:
                        file.type,
                    name:
                        file.name
                });
            }

            event.target.value = "";

            markDraft();

            await renderPortfolio(
                getActiveFilter()
            );
        }
    );

    admin
        .querySelector(
            ".delete-project"
        )
        .addEventListener(
            "click",
            async event => {
                event.stopPropagation();

                if (
                    !confirm(
                        "Delete this project?"
                    )
                ) {
                    return;
                }

                for (
                    const media
                    of project.media
                ) {
                    if (
                        media.localId
                    ) {
                        await deleteDraftBlob(
                            media.localId
                        );
                    }

                    if (
                        media.path &&
                        supabaseClient
                    ) {
                        await deleteCloudFile(
                            media.path
                        );
                    }
                }

                projects =
                    projects.filter(
                        p =>
                            p.id !==
                            project.id
                    );

                markDraft();

                await renderPortfolio(
                    getActiveFilter()
                );
            }
        );

    const mediaList =
        admin.querySelector(
            ".media-list"
        );

    project.media.forEach(
        (media, index) => {
            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "admin-media-item";

            createMediaElement(
                media
            ).then(
                element => {
                    item.appendChild(
                        element
                    );
                }
            );

            const remove =
                document.createElement(
                    "button"
                );

            remove.type =
                "button";

            remove.textContent =
                "×";

            remove.title =
                "Remove media";

            remove.addEventListener(
                "click",
                async event => {
                    event.stopPropagation();

                    if (
                        media.localId
                    ) {
                        await deleteDraftBlob(
                            media.localId
                        );
                    }

                    if (
                        media.path &&
                        supabaseClient
                    ) {
                        await deleteCloudFile(
                            media.path
                        );
                    }

                    project.media.splice(
                        index,
                        1
                    );

                    markDraft();

                    await renderPortfolio(
                        getActiveFilter()
                    );
                }
            );

            item.appendChild(
                remove
            );

            mediaList.appendChild(
                item
            );
        }
    );

    card.appendChild(
        admin
    );

    return card;
}

/* =========================================================
   VIEWER
========================================================= */

async function openViewer(
    projectId,
    index
) {
    viewerProjectId =
        projectId;

    viewerIndex =
        index;

    document
        .getElementById(
            "viewer"
        )
        .classList
        .add("open");

    await renderViewerMedia();
}

async function renderViewerMedia() {
    const project =
        projects.find(
            p =>
                p.id ===
                viewerProjectId
        );

    if (
        !project ||
        !project.media ||
        !project.media.length
    ) {
        return;
    }

    if (
        viewerIndex < 0
    ) {
        viewerIndex =
            project.media.length - 1;
    }

    if (
        viewerIndex >=
        project.media.length
    ) {
        viewerIndex = 0;
    }

    const media =
        project.media[
            viewerIndex
        ];

    const container =
        document.getElementById(
            "viewerMediaContainer"
        );

    container.innerHTML = "";

    const element =
        await createMediaElement(
            media
        );

    element.className =
        element.tagName ===
        "VIDEO"
            ? "viewer-video"
            : "viewer-media";

    if (
        element.tagName ===
        "VIDEO"
    ) {
        element.controls = true;
        element.autoplay = true;
        element.muted = true;
        element.playsInline = true;

        element.addEventListener(
            "loadedmetadata",
            () => {
                element
                    .play()
                    .catch(
                        () => {}
                    );
            }
        );
    }

    container.appendChild(
        element
    );

    document
        .getElementById(
            "viewerCounter"
        )
        .textContent =
        `${viewerIndex + 1} / ${project.media.length}`;
}

async function nextMedia() {
    const project =
        projects.find(
            p =>
                p.id ===
                viewerProjectId
        );

    if (!project) return;

    viewerIndex =
        (
            viewerIndex + 1
        ) %
        project.media.length;

    await renderViewerMedia();
}

async function previousMedia() {
    const project =
        projects.find(
            p =>
                p.id ===
                viewerProjectId
        );

    if (!project) return;

    viewerIndex--;

    if (
        viewerIndex < 0
    ) {
        viewerIndex =
            project.media.length - 1;
    }

    await renderViewerMedia();
}

function closeViewer() {
    const container =
        document.getElementById(
            "viewerMediaContainer"
        );

    container
        .querySelectorAll(
            "video"
        )
        .forEach(
            video => {
                try {
                    video.pause();
                    video.removeAttribute(
                        "src"
                    );
                    video.load();
                } catch (_) {}
            }
        );

    container.innerHTML = "";

    document
        .getElementById(
            "viewer"
        )
        .classList
        .remove("open");
}

/* =========================================================
   VIEWER EVENTS
========================================================= */

document
    .getElementById(
        "viewerNext"
    )
    .addEventListener(
        "click",
        event => {
            event.stopPropagation();
            nextMedia();
        }
    );

document
    .getElementById(
        "viewerPrev"
    )
    .addEventListener(
        "click",
        event => {
            event.stopPropagation();
            previousMedia();
        }
    );

document
    .getElementById(
        "viewerClose"
    )
    .addEventListener(
        "click",
        closeViewer
    );

document
    .getElementById(
        "viewer"
    )
    .addEventListener(
        "click",
        event => {
            if (
                event.target.id ===
                "viewer"
            ) {
                closeViewer();
            }
        }
    );

document.addEventListener(
    "keydown",
    event => {
        const viewer =
            document.getElementById(
                "viewer"
            );

        if (
            !viewer.classList.contains(
                "open"
            )
        ) {
            return;
        }

        if (
            event.key ===
            "ArrowRight"
        ) {
            nextMedia();
        }

        if (
            event.key ===
            "ArrowLeft"
        ) {
            previousMedia();
        }

        if (
            event.key ===
            "Escape"
        ) {
            closeViewer();
        }
    }
);

/* =========================================================
   FILTERS
========================================================= */

document
    .querySelectorAll(
        ".filter-btn"
    )
    .forEach(
        button => {
            button.addEventListener(
                "click",
                async function() {
                    document
                        .querySelectorAll(
                            ".filter-btn"
                        )
                        .forEach(
                            btn =>
                                btn.classList
                                    .remove(
                                        "active"
                                    )
                        );

                    this.classList.add(
                        "active"
                    );

                    await renderPortfolio(
                        this.dataset
                            .filter
                    );
                }
            );
        }
    );

function getActiveFilter() {
    const active =
        document.querySelector(
            ".filter-btn.active"
        );

    return active
        ? active.dataset.filter
        : "all";
}

/* =========================================================
   ADD PROJECT
========================================================= */

document
    .getElementById(
        "addProjectBtn"
    )
    .addEventListener(
        "click",
        async () => {
            const title =
                document
                    .getElementById(
                        "newProjectTitle"
                    )
                    .value
                    .trim();

            const category =
                document
                    .getElementById(
                        "newProjectCategory"
                    )
                    .value;

            const input =
                document
                    .getElementById(
                        "newProjectFiles"
                    );

            const files =
                Array.from(
                    input.files
                );

            if (!title) {
                alert(
                    "Please enter a project title."
                );
                return;
            }

            if (!files.length) {
                alert(
                    "Please select at least one image or video."
                );
                return;
            }

            const media = [];

            for (
                const file
                of files
            ) {
                if (
                    !file.type.startsWith(
                        "image/"
                    ) &&
                    !file.type.startsWith(
                        "video/"
                    )
                ) {
                    continue;
                }

                const localId =
                    await saveDraftBlob(
                        file,
                        file.name,
                        file.type
                    );

                media.push({
                    localId,
                    type:
                        file.type,
                    name:
                        file.name
                });
            }

            const project = {
                id:
                    makeId(
                        "project"
                    ),
                title,
                category,
                description:
                    "Custom model project.",
                media
            };

            projects.push(
                project
            );

            document
                .getElementById(
                    "newProjectTitle"
                )
                .value = "";

            input.value = "";

            markDraft();

            await renderPortfolio(
                getActiveFilter()
            );
        }
    );

/* =========================================================
   WHATSAPP
========================================================= */

document
    .getElementById(
        "contactForm"
    )
    .addEventListener(
        "submit",
        event => {
            event.preventDefault();

            const name =
                document
                    .getElementById(
                        "clientName"
                    )
                    .value
                    .trim();

            const kit =
                document
                    .getElementById(
                        "kitType"
                    )
                    .value
                    .trim();

            const service =
                document
                    .getElementById(
                        "serviceTier"
                    )
                    .value;

            const requests =
                document
                    .getElementById(
                        "specialRequests"
                    )
                    .value
                    .trim();

            const message =
                `Hello! My name is ${name}. ` +
                `I would like to get a quote for a ` +
                `${service} on my ${kit}. ` +
                `Special requests: ${requests}.`;

            window.location.href =
                "https://wa.me/601125041130?text=" +
                encodeURIComponent(
                    message
                );
        }
    );

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHTML(value) {
    const div =
        document.createElement(
            "div"
        );

    div.textContent =
        value || "";

    return div.innerHTML;
}

/* =========================================================
   INTERSECTION OBSERVER
========================================================= */

const observer =
    new IntersectionObserver(
        entries => {
            entries.forEach(
                entry => {
                    if (
                        entry.isIntersecting
                    ) {
                        entry.target
                            .classList
                            .add(
                                "visible"
                            );
                    }
                }
            );
        },
        {
            threshold: 0.12
        }
    );

document
    .querySelectorAll(
        ".reveal"
    )
    .forEach(
        element =>
            observer.observe(
                element
            )
    );

/* =========================================================
   BUTTONS
========================================================= */

document
    .getElementById(
        "editorToggle"
    )
    .addEventListener(
        "click",
        requestEditorAccess
    );

document
    .getElementById(
        "publishBtn"
    )
    .addEventListener(
        "click",
        publishChanges
    );

/* =========================================================
   INITIALIZATION
========================================================= */

async function initialize() {
    try {
        try {
            await openDatabase();
        } catch (dbError) {
            console.warn(
                "IndexedDB unavailable:",
                dbError
            );

            setStorageStatus(
                "IndexedDB unavailable. Cloud mode may still work."
            );
        }

        loadLocalState();

        await hydrateSite();

        await renderPortfolio(
            "all"
        );

        updateEditableState();

        if (
            supabaseClient
        ) {
            setStorageStatus(
                "☁ Cloud connection ready."
            );
        }
    } catch (error) {
        console.error(
            "Initialization error:",
            error
        );

        /*
          IMPORTANT:
          Do NOT throw a fatal Script error.
          The website remains usable.
        */

        if (
            !projects.length
        ) {
            projects =
                defaultProjects();
        }

        try {
            await renderPortfolio(
                "all"
            );
        } catch (_) {}

        setStorageStatus(
            "Website loaded with local fallback storage."
        );
    }
}

initialize();

