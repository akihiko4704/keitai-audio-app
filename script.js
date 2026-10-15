const audio = document.querySelector("#audioPlayer");
const fileInput = document.querySelector("#fileInput");
const folderInput = document.querySelector("#folderInput");
const folderImportButton = document.querySelector("#folderImportButton");
const folderImportMessage = document.querySelector("#folderImportMessage");
const dropZone = document.querySelector("#dropZone");
const trackList = document.querySelector("#trackList");
const queueEmpty = document.querySelector("#queueEmpty");
const queueSearch = document.querySelector("#queueSearch");
const queueNoResults = document.querySelector("#queueNoResults");
const playButton = document.querySelector("#playButton");
const seekBar = document.querySelector("#seekBar");
const trackTitle = document.querySelector("#trackTitle");
const trackMeta = document.querySelector("#trackMeta");
const currentChapterLabel = document.querySelector("#currentChapter");
const currentTimeLabel = document.querySelector("#currentTime");
const durationLabel = document.querySelector("#duration");
const trackCount = document.querySelector("#trackCount");
const clearButton = document.querySelector("#clearButton");
const coverArt = document.querySelector("#coverArt");
const coverImage = document.querySelector("#coverImage");
const coverInput = document.querySelector("#coverInput");
const coverUploadButton = document.querySelector("#coverUploadButton");
const repeatButton = document.querySelector("#repeatButton");
const repeatBadge = document.querySelector("#repeatBadge");
const chapterList = document.querySelector("#chapterList");
const chaptersEmpty = document.querySelector("#chaptersEmpty");
const chapterPosition = document.querySelector("#chapterPosition");
const addChapterButton = document.querySelector("#addChapterButton");
const previousChapterButton = document.querySelector("#previousChapterButton");
const nextChapterButton = document.querySelector("#nextChapterButton");

let tracks = [];
let currentIndex = -1;
let activeUrl = null;
let repeatMode = "off";
const thumbnails = new Map();
const chaptersByTrack = new Map();
const chapterLoadErrors = new Set();
const trackStorageIds = new Map();
let audioLibrary = null;
let audioLibraryReady;

function openAudioLibrary() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = window.indexedDB.open("audiobook-player", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open audio library"));
    request.onblocked = () => reject(new Error("Opening the audio library was blocked"));
  });
}

function readStoredTracks(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("tracks", "readonly");
    const request = transaction.objectStore("tracks").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not read audio library"));
    transaction.onabort = () => reject(transaction.error || new Error("Reading the audio library was aborted"));
  });
}

function initializeAudioLibrary() {
  return openAudioLibrary().then(async (database) => {
    audioLibrary = database;
    const storedTracks = await readStoredTracks(database);
    for (const storedTrack of storedTracks) {
      const track = storedTrack.remoteUrl
        ? { name: storedTrack.name, remoteUrl: storedTrack.remoteUrl }
        : new File([storedTrack.blob], storedTrack.name, {
            type: storedTrack.type,
            lastModified: storedTrack.lastModified,
          });
      tracks.push(track);
      trackStorageIds.set(track, storedTrack.id);
      if (!track.remoteUrl) loadTrackMetadata([track]);
    }
    updateQueue();
    if (tracks.length > 0) loadTrack(0);
    return database;
  }).catch((error) => {
    console.error("Could not restore the audio library:", error);
    trackMeta.textContent = "保存済みの音源を読み込めませんでした。ブラウザーの保存領域を確認してください。";
    return null;
  });
}

async function writeAudioLibrary(write) {
  const database = await audioLibraryReady;
  if (!database) throw new Error("Audio library is not available");

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = database.transaction("tracks", "readwrite");
      write(transaction.objectStore("tracks"));
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not save audio library"));
    transaction.onabort = () => reject(transaction.error || new Error("Saving the audio library was aborted"));
  });
}

function storedTrackRecord(track) {
  if (track.remoteUrl) return { name: track.name, remoteUrl: track.remoteUrl };
  return {
    name: track.name,
    type: track.type,
    lastModified: track.lastModified,
    blob: track,
  };
}

async function persistTracks(newTracks) {
  const ids = [];
  await writeAudioLibrary((store) => {
    newTracks.forEach((track, index) => {
      const request = store.add(storedTrackRecord(track));
      request.onsuccess = () => {
        ids[index] = request.result;
      };
    });
  });
  newTracks.forEach((track, index) => trackStorageIds.set(track, ids[index]));
}

async function removePersistedTrack(track) {
  const id = trackStorageIds.get(track);
  if (id === undefined) return;
  await writeAudioLibrary((store) => store.delete(id));
  trackStorageIds.delete(track);
}

async function clearPersistedTracks() {
  await writeAudioLibrary((store) => store.clear());
  trackStorageIds.clear();
}

async function saveTracks(newTracks) {
  try {
    await persistTracks(newTracks);
    return true;
  } catch (error) {
    console.error("Could not save added tracks:", error);
    trackMeta.textContent = "音源は再生できますが、次回のための保存に失敗しました。ブラウザーの空き容量を確認してください。";
    return false;
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function releaseActiveUrl() {
  if (activeUrl?.startsWith("blob:")) URL.revokeObjectURL(activeUrl);
  activeUrl = null;
}

function decodeChapterTitle(bytes) {
  if (bytes.length === 0) return "";
  const encoding = bytes[0];
  let text;
  try {
    if (encoding === 1) text = new TextDecoder("utf-16").decode(bytes.subarray(1));
    else if (encoding === 2) text = new TextDecoder("utf-16be").decode(bytes.subarray(1));
    else if (encoding === 3) text = new TextDecoder("utf-8").decode(bytes.subarray(1));
    else text = new TextDecoder("windows-1252").decode(bytes.subarray(1));
  } catch {
    text = new TextDecoder().decode(bytes.subarray(1));
  }
  return text.replace(/\0+$/g, "").trim();
}

function parseId3Artist(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 3)) !== "ID3") return "";
  const version = bytes[3];
  if (version < 3 || version > 4) return "";
  const tagSize = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const tagEnd = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;
  if (bytes[5] & 0x40) {
    if (offset + 4 > tagEnd) return "";
    const extendedSize = version === 4
      ? ((bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3])
      : view.getUint32(offset);
    offset += version === 4 ? extendedSize : extendedSize + 4;
  }

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const size = version === 4
      ? ((bytes[offset + 4] << 21) | (bytes[offset + 5] << 14) | (bytes[offset + 6] << 7) | bytes[offset + 7])
      : view.getUint32(offset + 4);
    const frameStart = offset + 10;
    const frameEnd = frameStart + size;
    if (size <= 0 || frameEnd > tagEnd) break;
    if (frameId === "TPE1") return decodeChapterTitle(bytes.subarray(frameStart, frameEnd));
    offset = frameEnd;
  }
  return "";
}

function parseId3Chapters(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 3)) !== "ID3") return [];
  const version = bytes[3];
  if (version < 3 || version > 4) return [];
  const tagSize = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const tagEnd = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;
  if (bytes[5] & 0x40) {
    if (offset + 4 > tagEnd) return [];
    const extendedSize = version === 4
      ? ((bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3])
      : view.getUint32(offset);
    offset += version === 4 ? extendedSize : extendedSize + 4;
  }

  async function parseMp4Artist(file) {
    const chunkSize = 2 * 1024 * 1024;
    const overlap = 16;
    for (let start = 0; start < file.size; start += chunkSize) {
      const end = Math.min(file.size, start + chunkSize + overlap);
      const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
      for (let index = 4; index + 12 <= bytes.length; index += 1) {
        if (bytes[index] !== 0xa9 || bytes[index + 1] !== 0x41 || bytes[index + 2] !== 0x52 || bytes[index + 3] !== 0x54) continue;
        const atomStart = index - 4;
        const atomSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(atomStart);
        const absoluteStart = start + atomStart;
        if (atomSize < 24 || atomSize > 1024 * 1024 || absoluteStart + atomSize > file.size) continue;
        const atom = new Uint8Array(await file.slice(absoluteStart, absoluteStart + atomSize).arrayBuffer());
        const dataSize = new DataView(atom.buffer, atom.byteOffset, atom.byteLength).getUint32(8);
        if (dataSize < 16 || 8 + dataSize > atom.length || String.fromCharCode(...atom.subarray(12, 16)) !== "data") continue;
        return new TextDecoder("utf-8").decode(atom.subarray(24, 8 + dataSize)).replace(/\0/g, "").trim();
      }
    }
    return "";
  }

  const chapters = [];
  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const size = version === 4
      ? ((bytes[offset + 4] << 21) | (bytes[offset + 5] << 14) | (bytes[offset + 6] << 7) | bytes[offset + 7])
      : view.getUint32(offset + 4);
    const frameStart = offset + 10;
    const frameEnd = frameStart + size;
    if (size <= 0 || frameEnd > tagEnd) break;

    if (frameId === "CHAP" && size >= 17) {
      const chapterIdEnd = bytes.indexOf(0, frameStart);
      const dataStart = chapterIdEnd + 1;
      if (chapterIdEnd >= frameStart && dataStart + 16 <= frameEnd) {
        const time = view.getUint32(dataStart) / 1000;
        let subframeOffset = dataStart + 16;
        let title = "";
        while (subframeOffset + 10 <= frameEnd) {
          const subframeId = String.fromCharCode(...bytes.subarray(subframeOffset, subframeOffset + 4));
          const subframeSize = version === 4
            ? ((bytes[subframeOffset + 4] << 21) | (bytes[subframeOffset + 5] << 14) | (bytes[subframeOffset + 6] << 7) | bytes[subframeOffset + 7])
            : view.getUint32(subframeOffset + 4);
          const subframeStart = subframeOffset + 10;
          if (subframeSize <= 0 || subframeStart + subframeSize > frameEnd) break;
          if (subframeId === "TIT2") {
            title = decodeChapterTitle(bytes.subarray(subframeStart, subframeStart + subframeSize));
            break;
          }
          subframeOffset = subframeStart + subframeSize;
        }
        if (Number.isFinite(time) && time >= 0) {
          chapters.push({ time, title: title || `チャプター ${chapters.length + 1}`, source: "embedded" });
        }
      }
    }
    offset = frameEnd;
  }
  return chapters.sort((a, b) => a.time - b.time);
}

function detectImageType(bytes, fallback = "") {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 3)) === "GIF") return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return fallback.startsWith("image/") ? fallback : "";
}

function parseId3Artwork(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 3)) !== "ID3") return null;
  const version = bytes[3];
  if (version < 3 || version > 4) return null;
  const tagSize = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const tagEnd = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;
  if (bytes[5] & 0x40) {
    if (offset + 4 > tagEnd) return null;
    const extendedSize = version === 4
      ? ((bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3])
      : view.getUint32(offset);
    offset += version === 4 ? extendedSize : extendedSize + 4;
  }

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const size = version === 4
      ? ((bytes[offset + 4] << 21) | (bytes[offset + 5] << 14) | (bytes[offset + 6] << 7) | bytes[offset + 7])
      : view.getUint32(offset + 4);
    const frameStart = offset + 10;
    const frameEnd = frameStart + size;
    if (size <= 0 || frameEnd > tagEnd) break;

    if (frameId === "APIC" && size > 5) {
      const encoding = bytes[frameStart];
      const mimeEnd = bytes.indexOf(0, frameStart + 1);
      if (mimeEnd >= 0 && mimeEnd + 2 < frameEnd) {
        const mime = String.fromCharCode(...bytes.subarray(frameStart + 1, mimeEnd)).toLowerCase();
        const descriptionStart = mimeEnd + 2;
        let descriptionEnd = -1;
        let terminatorSize = 1;
        if (encoding === 1 || encoding === 2) {
          terminatorSize = 2;
          for (let index = descriptionStart; index + 1 < frameEnd; index += 2) {
            if (bytes[index] === 0 && bytes[index + 1] === 0) {
              descriptionEnd = index;
              break;
            }
          }
        } else {
          descriptionEnd = bytes.indexOf(0, descriptionStart);
        }
        if (descriptionEnd >= 0) {
          const imageStart = descriptionEnd + terminatorSize;
          const imageBytes = bytes.subarray(imageStart, frameEnd);
          const type = detectImageType(imageBytes, mime);
          if (imageBytes.length > 0 && type) return new Blob([imageBytes], { type });
        }
      }
    }
    offset = frameEnd;
  }
  return null;
}

async function parseMp4Chapters(file) {
  const chunkSize = 2 * 1024 * 1024;
  const overlap = 16;
  for (let start = 0; start < file.size; start += chunkSize) {
    const end = Math.min(file.size, start + chunkSize + overlap);
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    for (let index = 4; index + 9 <= bytes.length; index += 1) {
      if (bytes[index] !== 0x63 || bytes[index + 1] !== 0x68 || bytes[index + 2] !== 0x70 || bytes[index + 3] !== 0x6c) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const atomStart = index - 4;
      const atomSize = view.getUint32(atomStart);
      const absoluteStart = start + atomStart;
      if (atomSize < 17 || atomSize > 1024 * 1024 || absoluteStart + atomSize > file.size) continue;
      const atom = new Uint8Array(await file.slice(absoluteStart, absoluteStart + atomSize).arrayBuffer());
      const payloadStart = 8;
      const chapterCount = atom[payloadStart + 8];
      let offset = payloadStart + 9;
      const chapters = [];
      for (let chapterIndex = 0; chapterIndex < chapterCount && offset + 9 <= atom.length; chapterIndex += 1) {
        const timeTicks = new DataView(atom.buffer, atom.byteOffset + offset, 8).getBigUint64(0);
        offset += 8;
        const titleLength = atom[offset++];
        if (offset + titleLength > atom.length) break;
        const title = new TextDecoder("utf-8").decode(atom.subarray(offset, offset + titleLength)).trim();
        offset += titleLength;
        chapters.push({
          time: Number(timeTicks) / 10_000_000,
          title: title || `チャプター ${chapterIndex + 1}`,
          source: "embedded",
        });
      }
      if (chapters.length > 0) return chapters.sort((a, b) => a.time - b.time);
    }
  }
  return [];
}

async function parseMp4Artwork(file) {
  const chunkSize = 2 * 1024 * 1024;
  const overlap = 16;
  const maxArtworkSize = 32 * 1024 * 1024;
  for (let start = 0; start < file.size; start += chunkSize) {
    const end = Math.min(file.size, start + chunkSize + overlap);
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    for (let index = 4; index + 8 <= bytes.length; index += 1) {
      if (bytes[index] !== 0x63 || bytes[index + 1] !== 0x6f || bytes[index + 2] !== 0x76 || bytes[index + 3] !== 0x72) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const atomStart = index - 4;
      const atomSize = view.getUint32(atomStart);
      const absoluteStart = start + atomStart;
      if (atomSize < 24 || atomSize > maxArtworkSize || absoluteStart + atomSize > file.size) continue;

      const atom = new Uint8Array(await file.slice(absoluteStart, absoluteStart + atomSize).arrayBuffer());
      const atomView = new DataView(atom.buffer, atom.byteOffset, atom.byteLength);
      let offset = 8;
      while (offset + 16 <= atom.length) {
        const dataSize = atomView.getUint32(offset);
        const dataType = String.fromCharCode(...atom.subarray(offset + 4, offset + 8));
        if (dataSize < 16 || offset + dataSize > atom.length) break;
        if (dataType === "data") {
          const imageKind = atomView.getUint32(offset + 8) & 0xffffff;
          const imageBytes = atom.subarray(offset + 16, offset + dataSize);
          const fallback = imageKind === 13 ? "image/jpeg" : imageKind === 14 ? "image/png" : "";
          const type = detectImageType(imageBytes, fallback);
          if (imageBytes.length > 0 && type) return new Blob([imageBytes], { type });
        }
        offset += dataSize;
      }
    }
  }
  return null;
}

async function readEmbeddedChapters(file) {
  if (/\.mp3$/i.test(file.name)) {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (header.length < 10 || String.fromCharCode(...header.subarray(0, 3)) !== "ID3") return [];
    const tagSize = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9];
    const maxTagSize = 64 * 1024 * 1024;
    if (tagSize > maxTagSize) throw new Error("ID3 tag is larger than the 64 MB parsing limit");
    const tag = new Uint8Array(await file.slice(0, Math.min(file.size, tagSize + 10)).arrayBuffer());
    return parseId3Chapters(tag);
  }
  if (/\.(m4a|m4b|mp4|aac)$/i.test(file.name)) return parseMp4Chapters(file);
  return [];
}

async function readEmbeddedArtist(file) {
  if (/\.mp3$/i.test(file.name)) {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (header.length < 10 || String.fromCharCode(...header.subarray(0, 3)) !== "ID3") return "";
    const tagSize = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9];
    const maxTagSize = 64 * 1024 * 1024;
    if (tagSize > maxTagSize) throw new Error("ID3 tag is larger than the 64 MB parsing limit");
    const tag = new Uint8Array(await file.slice(0, Math.min(file.size, tagSize + 10)).arrayBuffer());
    return parseId3Artist(tag);
  }
  if (/\.(m4a|m4b|mp4|aac)$/i.test(file.name)) return parseMp4Artist(file);
  return "";
}

async function readEmbeddedArtwork(file) {
  if (/\.(mp3|aac)$/i.test(file.name)) {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (header.length >= 10 && String.fromCharCode(...header.subarray(0, 3)) === "ID3") {
      const tagSize = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9];
      const maxTagSize = 64 * 1024 * 1024;
      if (tagSize > maxTagSize) throw new Error("ID3 tag is larger than the 64 MB parsing limit");
      const tag = new Uint8Array(await file.slice(0, Math.min(file.size, tagSize + 10)).arrayBuffer());
      return parseId3Artwork(tag);
    }
    if (/\.aac$/i.test(file.name)) return parseMp4Artwork(file);
    return null;
  }
  if (/\.(m4a|m4b|mp4)$/i.test(file.name)) return parseMp4Artwork(file);
  return null;
}

function currentChapters() {
  return tracks[currentIndex] ? chaptersByTrack.get(tracks[currentIndex]) || [] : [];
}

function activeChapterIndex(chapters = currentChapters()) {
  for (let index = chapters.length - 1; index >= 0; index -= 1) {
    if (audio.currentTime >= chapters[index].time) return index;
  }
  return -1;
}

function renderChapters() {
  const chapters = currentChapters();
  const activeIndex = activeChapterIndex(chapters);
  const activeChapter = chapters[activeIndex];
  currentChapterLabel.textContent = activeChapter ? `♫ ${activeChapter.title}` : "";
  currentChapterLabel.hidden = !activeChapter;
  chapterList.replaceChildren();
  chapterList.hidden = chapters.length === 0;
  chaptersEmpty.hidden = chapters.length > 0;
  chaptersEmpty.textContent = tracks[currentIndex] && chapterLoadErrors.has(tracks[currentIndex])
    ? "チャプター情報を読み込めませんでした。再生位置から追加できます。"
    : "チャプター情報がありません。再生位置から追加できます。";
  addChapterButton.disabled = currentIndex < 0;
  previousChapterButton.disabled = currentIndex < 0 || chapters.length === 0;
  nextChapterButton.disabled = currentIndex < 0 || chapters.length === 0;

  chapters.forEach((chapter, index) => {
    const item = document.createElement("li");
    item.className = "chapter-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chapter-select${index === activeIndex ? " is-active" : ""}`;
    button.setAttribute("aria-current", index === activeIndex ? "true" : "false");
    const time = document.createElement("span");
    time.className = "chapter-time";
    time.textContent = formatTime(chapter.time);
    const name = document.createElement("span");
    name.className = "chapter-name";
    name.textContent = chapter.title;
    button.append(time, name);
    button.addEventListener("click", () => {
      audio.currentTime = chapter.time;
      if (audio.paused) playAudio();
    });
    item.append(button);
    chapterList.append(item);
  });
  updateActiveChapter();
}

function updateActiveChapter() {
  const chapters = currentChapters();
  const activeIndex = activeChapterIndex(chapters);
  const activeChapter = chapters[activeIndex];
  chapterPosition.textContent = activeChapter ? `${activeIndex + 1} / ${chapters.length}` : "—";
  currentChapterLabel.textContent = activeChapter ? `♫ ${activeChapter.title}` : "";
  currentChapterLabel.hidden = !activeChapter;
  chapterList.querySelectorAll(".chapter-select").forEach((button, index) => {
    const isActive = index === activeIndex;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", String(isActive));
  });
  previousChapterButton.disabled = currentIndex < 0 || chapters.length === 0 || activeIndex < 0;
  nextChapterButton.disabled = currentIndex < 0 || activeIndex >= chapters.length - 1;
}

function updateQueue() {
  trackList.replaceChildren();
  queueEmpty.hidden = tracks.length > 0;
  queueSearch.parentElement.hidden = tracks.length === 0;
  clearButton.hidden = tracks.length === 0;
  trackCount.textContent = `${tracks.length} ${tracks.length === 1 ? "TRACK" : "TRACKS"}`;
  const query = queueSearch.value.trim().toLocaleLowerCase();
  const matchingTracks = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => !query || `${track.name} ${track.author || ""}`.toLocaleLowerCase().includes(query));
  queueNoResults.hidden = tracks.length === 0 || matchingTracks.length > 0;
  trackList.hidden = matchingTracks.length === 0;

  matchingTracks.forEach(({ track, index }) => {
    const item = document.createElement("li");
    item.className = `track-item${index === currentIndex ? " is-current" : ""}`;
    item.setAttribute("aria-current", index === currentIndex ? "true" : "false");

    const thumbnail = document.createElement("span");
    thumbnail.className = "track-thumb";
    const thumbnailUrl = thumbnails.get(track);
    if (thumbnailUrl) {
      const image = document.createElement("img");
      image.src = thumbnailUrl;
      image.alt = "";
      thumbnail.append(image);
    } else {
      thumbnail.textContent = "♫";
      thumbnail.setAttribute("aria-hidden", "true");
    }

    const select = document.createElement("button");
    select.type = "button";
    select.className = "track-select";
    select.setAttribute("aria-label", `${index + 1}番目のトラックを再生: ${track.name}`);
    select.setAttribute("aria-pressed", String(index === currentIndex));

    const size = document.createElement("span");
    size.className = "track-size";
    size.textContent = track.remoteUrl ? "STREAM" : formatSize(track.size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "track-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${track.name} を削除`);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeTrack(index);
    });

    const name = document.createElement("span");
    name.className = "track-name";
    name.textContent = track.name.replace(/\.[^.]+$/, "");
    name.title = track.name;
    const details = document.createElement("span");
    details.className = "track-info";
    details.append(name);
    if (track.author) {
      const author = document.createElement("span");
      author.className = "track-author";
      author.textContent = track.author;
      details.append(author);
    }

    const playIcon = document.createElement("span");
    playIcon.className = "track-play-icon";
    playIcon.setAttribute("aria-hidden", "true");
    playIcon.textContent = index === currentIndex && !audio.paused ? "Ⅱ" : "▶";

    select.append(thumbnail, details);
    select.append(playIcon);
    select.addEventListener("click", () => loadTrack(index, true));
    item.append(select, size, remove);
    trackList.append(item);
  });
}

function loadTrack(index, autoplay = false) {
  if (index < 0 || index >= tracks.length) return;
  releaseActiveUrl();
  currentIndex = index;
  const track = tracks[index];
  if (track.remoteUrl) audio.src = track.remoteUrl;
  else {
    activeUrl = URL.createObjectURL(track);
    audio.src = activeUrl;
  }
  audio.loop = repeatMode === "one";
  showThumbnail();
  trackTitle.textContent = track.name.replace(/\.[^.]+$/, "");
  trackMeta.textContent = track.remoteUrl ? "ネットワーク音源をストリーミング" : "ローカルオーディオブック";
  playButton.disabled = false;
  seekBar.disabled = false;
  currentTimeLabel.textContent = "0:00";
  durationLabel.textContent = "0:00";
  updateQueue();
  renderChapters();
  if (autoplay) playAudio();
}

function showThumbnail() {
  const track = tracks[currentIndex];
  const thumbnailUrl = track && thumbnails.get(track);
  coverArt.classList.toggle("has-image", Boolean(thumbnailUrl));
  coverImage.hidden = !thumbnailUrl;
  coverImage.alt = thumbnailUrl ? `${track.name} のサムネイル` : "";
  if (thumbnailUrl) coverImage.src = thumbnailUrl;
  else coverImage.removeAttribute("src");
  coverUploadButton.disabled = !track;
}

async function playAudio() {
  if (!audio.src) return;
  try {
    await audio.play();
  } catch (error) {
    trackMeta.textContent = "この音声ファイルを再生できませんでした。別のファイルをお試しください。";
    console.error("Audio playback failed:", error);
  }
}

async function addFiles(fileList) {
  const selectedFiles = Array.from(fileList);
  await audioLibraryReady;
  const audioFiles = selectedFiles.filter((file) =>
    file.type.startsWith("audio/") || /\.(mp3|m4a|m4b|aac|wav|ogg|flac|opus)$/i.test(file.name)
  );
  if (audioFiles.length === 0) {
    trackMeta.textContent = "音声ファイルを選択してください。";
    return { addedCount: 0, saved: false };
  }

  const wasEmpty = tracks.length === 0;
  tracks.push(...audioFiles);
  updateQueue();
  if (wasEmpty) loadTrack(0);
  loadTrackMetadata(audioFiles);
  const saved = await saveTracks(audioFiles);
  if (audioFiles.length < selectedFiles.length) {
    trackMeta.textContent = saved
      ? "一部のファイルは音声形式ではないため追加されませんでした。"
      : "一部のファイルは音声形式ではないため追加されず、音源の保存にも失敗しました。";
  }
  return { addedCount: audioFiles.length, saved };
}

function loadTrackMetadata(files) {
  for (const file of files) {
    readEmbeddedArtist(file).then((author) => {
      if (!tracks.includes(file) || !author) return;
      file.author = author;
      updateQueue();
    }).catch((error) => {
      console.error(`Could not read embedded author from "${file.name}":`, error);
    });
    readEmbeddedChapters(file).then((chapters) => {
      if (!tracks.includes(file)) return;
      chapterLoadErrors.delete(file);
      if (chapters.length > 0) chaptersByTrack.set(file, chapters);
      if (tracks[currentIndex] === file) renderChapters();
    }).catch((error) => {
      if (!tracks.includes(file)) return;
      chapterLoadErrors.add(file);
      console.error(`Could not read embedded chapters from "${file.name}":`, error);
      if (tracks[currentIndex] === file) renderChapters();
    });
    readEmbeddedArtwork(file).then((artwork) => {
      if (!artwork || !tracks.includes(file) || thumbnails.has(file)) return;
      thumbnails.set(file, URL.createObjectURL(artwork));
      updateQueue();
      if (tracks[currentIndex] === file) showThumbnail();
    }).catch((error) => {
      console.error(`Could not read embedded artwork from "${file.name}":`, error);
    });
  }
}

function removeTrack(index) {
  const wasCurrent = index === currentIndex;
  const [removedTrack] = tracks.splice(index, 1);
  removePersistedTrack(removedTrack).catch((error) => {
    console.error(`Could not remove "${removedTrack.name}" from the audio library:`, error);
    trackMeta.textContent = "この音源を保存領域から削除できませんでした。";
  });
  chaptersByTrack.delete(removedTrack);
  chapterLoadErrors.delete(removedTrack);
  const thumbnailUrl = thumbnails.get(removedTrack);
  if (thumbnailUrl) {
    URL.revokeObjectURL(thumbnailUrl);
    thumbnails.delete(removedTrack);
  }

  if (tracks.length === 0) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    releaseActiveUrl();
    queueSearch.value = "";
    currentIndex = -1;
    showThumbnail();
    trackTitle.textContent = "まだ本が選ばれていません";
    trackMeta.textContent = "音声ファイルを追加して、再生をはじめましょう。";
    playButton.disabled = true;
    seekBar.disabled = true;
    currentTimeLabel.textContent = "0:00";
    durationLabel.textContent = "0:00";
    updateActiveChapter();
  } else if (wasCurrent) {
    loadTrack(Math.min(index, tracks.length - 1));
  } else if (index < currentIndex) {
    currentIndex -= 1;
    showThumbnail();
  }
  updateQueue();
  renderChapters();
}

playButton.addEventListener("click", () => {
  if (audio.paused) playAudio();
  else audio.pause();
});

document.querySelector("#previousButton").addEventListener("click", () => {
  if (currentIndex < 0 || tracks.length === 0) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  loadTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
});

document.querySelector("#nextButton").addEventListener("click", () => {
  if (currentIndex < 0 || tracks.length === 0) return;
  loadTrack((currentIndex + 1) % tracks.length, true);
});

document.querySelector("#backButton").addEventListener("click", () => {
  audio.currentTime = Math.max(0, audio.currentTime - 15);
});

document.querySelector("#forwardButton").addEventListener("click", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
});

previousChapterButton.addEventListener("click", () => {
  const chapters = currentChapters();
  const activeIndex = activeChapterIndex(chapters);
  if (activeIndex < 0) return;
  const targetIndex = audio.currentTime - chapters[activeIndex].time > 3 ? activeIndex : activeIndex - 1;
  if (targetIndex >= 0) audio.currentTime = chapters[targetIndex].time;
  else audio.currentTime = 0;
});

nextChapterButton.addEventListener("click", () => {
  const chapters = currentChapters();
  const nextIndex = activeChapterIndex(chapters) + 1;
  if (nextIndex >= 0 && nextIndex < chapters.length) audio.currentTime = chapters[nextIndex].time;
});

addChapterButton.addEventListener("click", () => {
  if (currentIndex < 0) return;
  const chapters = currentChapters();
  const suggestedTitle = `チャプター ${chapters.length + 1}`;
  const title = window.prompt("チャプター名を入力してください。", suggestedTitle);
  if (title === null) return;
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    trackMeta.textContent = "チャプター名を入力してください。";
    return;
  }
  chapters.push({ time: audio.currentTime, title: trimmedTitle, source: "manual" });
  chapters.sort((a, b) => a.time - b.time);
  chaptersByTrack.set(tracks[currentIndex], chapters);
  renderChapters();
});

seekBar.addEventListener("input", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seekBar.value) / 1000) * audio.duration;
});

document.querySelector("#volumeBar").addEventListener("input", (event) => {
  audio.volume = Number(event.target.value);
});

document.querySelector("#speedSelect").addEventListener("change", (event) => {
  audio.playbackRate = Number(event.target.value);
});

repeatButton.addEventListener("click", () => {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  audio.loop = repeatMode === "one";
  const labels = {
    off: "リピート: オフ",
    all: "リピート: 全曲",
    one: "リピート: 1曲",
  };
  repeatButton.setAttribute("aria-label", labels[repeatMode]);
  repeatButton.title = `${labels[repeatMode]}（クリックで切り替え）`;
  repeatButton.setAttribute("aria-pressed", String(repeatMode !== "off"));
  repeatBadge.hidden = repeatMode !== "one";
});

fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files).catch((error) => {
    console.error("Could not add selected audio files:", error);
    trackMeta.textContent = "選択した音源を追加できませんでした。";
  });
  fileInput.value = "";
});

folderImportButton.addEventListener("click", () => folderInput.click());

folderInput.addEventListener("change", () => {
  folderImportMessage.textContent = "";
  addFiles(folderInput.files).then(({ addedCount, saved }) => {
    if (addedCount === 0) {
      folderImportMessage.textContent = "選択したフォルダに音声ファイルが見つかりませんでした。";
    } else {
      folderImportMessage.textContent = saved
        ? `${addedCount} 件の音声ファイルを再生リストに追加・保存しました。`
        : `${addedCount} 件を再生リストに追加しましたが、保存に失敗しました。`;
    }
  }).catch((error) => {
    console.error("Could not import audio files from the selected folder:", error);
    folderImportMessage.textContent = "フォルダ内の音源を追加できませんでした。";
  });
  folderInput.value = "";
});

coverUploadButton.addEventListener("click", () => {
  if (currentIndex >= 0) coverInput.click();
});

coverInput.addEventListener("change", () => {
  const image = coverInput.files[0];
  coverInput.value = "";
  if (!image) return;
  if (!image.type.startsWith("image/")) {
    trackMeta.textContent = "サムネイルには画像ファイルを選択してください。";
    return;
  }

  const track = tracks[currentIndex];
  if (!track) return;
  const previousUrl = thumbnails.get(track);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  thumbnails.set(track, URL.createObjectURL(image));
  showThumbnail();
  updateQueue();
});

clearButton.addEventListener("click", () => {
  clearPersistedTracks().catch((error) => {
    console.error("Could not clear the audio library:", error);
    trackMeta.textContent = "保存済み音源を削除できませんでした。";
  });
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  releaseActiveUrl();
  for (const thumbnailUrl of thumbnails.values()) URL.revokeObjectURL(thumbnailUrl);
  thumbnails.clear();
  chaptersByTrack.clear();
  chapterLoadErrors.clear();
  tracks = [];
  queueSearch.value = "";
  currentIndex = -1;
  trackTitle.textContent = "まだ本が選ばれていません";
  trackMeta.textContent = "音声ファイルを追加して、再生をはじめましょう。";
  playButton.disabled = true;
  seekBar.disabled = true;
  currentTimeLabel.textContent = "0:00";
  durationLabel.textContent = "0:00";
  showThumbnail();
  updateQueue();
  renderChapters();
});

queueSearch.addEventListener("input", updateQueue);

audio.addEventListener("timeupdate", () => {
  currentTimeLabel.textContent = formatTime(audio.currentTime);
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    seekBar.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  }
  updateActiveChapter();
});

audio.addEventListener("loadedmetadata", () => {
  durationLabel.textContent = formatTime(audio.duration);
  renderChapters();
});

audio.addEventListener("error", () => {
  if (tracks[currentIndex]?.remoteUrl) {
    trackMeta.textContent = "音声を読み込めません。URL、Tailscale接続、配信元の設定を確認してください。";
  }
});

audio.addEventListener("play", () => {
  playButton.classList.add("is-playing");
  playButton.setAttribute("aria-label", "一時停止");
  updateQueue();
});

audio.addEventListener("pause", () => {
  playButton.classList.remove("is-playing");
  playButton.setAttribute("aria-label", "再生");
  updateQueue();
});

audio.addEventListener("ended", () => {
  if (currentIndex < tracks.length - 1) loadTrack(currentIndex + 1, true);
  else if (repeatMode === "all" && tracks.length > 0) loadTrack(0, true);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", (event) => {
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  addFiles(event.dataTransfer.files).catch((error) => {
    console.error("Could not add dropped audio files:", error);
    trackMeta.textContent = "ドロップした音源を追加できませんでした。";
  });
});

audio.volume = 0.8;
audioLibraryReady = initializeAudioLibrary();
updateQueue();
renderChapters();
