/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMusicXml, serializeMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import { setFretCommand } from '../src/score-edit.js';
import { packMxl } from '../src/mxl.js';
import {
  createMusicXmlDownload,
  createMusicXmlImportController,
  decodeMusicXmlFile,
  prepareMusicXmlImport,
  sanitizeScoreFilename
} from '../src/file-workflow.js';
import {
  KEY_V4, currentSong, importMusicXmlSong, library, load, state, toDoc, useStorage
} from '../src/state.js';

const moduleUrl = import.meta.url;
const multipart = readFileSync(new URL('./fixtures/multipart.musicxml', moduleUrl), 'utf8');

function storageWith(value = null) {
  let raw = value;
  return {
    getItem: vi.fn(() => raw),
    setItem: vi.fn((_key, next) => { raw = next; }),
    value: () => raw
  };
}

describe('MusicXML file workflow', () => {
  beforeEach(() => {
    useStorage(storageWith());
    load();
  });

  it('preserves unselected vocal and Gt2 parts while editing selected Gt1', () => {
    const doc = parseMusicXml(multipart);
    const before = serializeMusicXml(doc);
    const p1 = before.match(/<part id="P1">[\s\S]*?<\/part>/)[0];
    const p3 = before.match(/<part id="P3">[\s\S]*?<\/part>/)[0];
    const eventId = buildScoreIndex(doc, 'P2').measures[0].events[0].id;

    setFretCommand(doc, 'P2', eventId, 9).apply();
    const output = serializeMusicXml(doc);

    expect(output.match(/<part id="P1">[\s\S]*?<\/part>/)[0]).toBe(p1);
    expect(output.match(/<part id="P3">[\s\S]*?<\/part>/)[0]).toBe(p3);
    expect(buildScoreIndex(parseMusicXml(output), 'P2').measures[0].events[0].notes[0].fret).toBe(9);
  });

  it('decodes XML as strict UTF-8 with BOM and rejects malformed UTF-8', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(multipart)]);
    expect((await decodeMusicXmlFile(new File([bom], 'SCORE.XML'))).xml).toContain('<score-partwise');
    await expect(decodeMusicXmlFile(new File([new Uint8Array([0xc3, 0x28])], 'bad.musicxml')))
      .rejects.toThrow(/UTF-8/);
  });

  it('accepts MXL case-insensitively and uses a MIME fallback', async () => {
    const mxl = new File([packMxl(multipart)], 'SCORE.MXL', { type: 'application/octet-stream' });
    expect((await decodeMusicXmlFile(mxl)).xml).toContain('Multipart Test');
    const mimeOnly = new File([multipart], 'score.data', { type: 'application/vnd.recordare.musicxml+xml' });
    expect((await decodeMusicXmlFile(mimeOnly)).xml).toContain('Multipart Test');
  });

  it('prepares all TAB candidates without mutating the library', async () => {
    const before = JSON.stringify(toDoc());
    const prepared = await prepareMusicXmlImport(new File([multipart], 'band.musicxml'));
    expect(prepared.parts).toEqual([
      expect.objectContaining({ id: 'P2', name: 'Gt1' }),
      expect.objectContaining({ id: 'P3', name: 'Gt2' })
    ]);
    expect(prepared.title).toBe('Multipart Test');
    expect(JSON.stringify(toDoc())).toBe(before);
  });

  it('uses movement metadata and then the filename as import title fallbacks', async () => {
    const movement = multipart.replace(
      '<work><work-title>Multipart Test</work-title></work>',
      '<movement-title>Movement Name</movement-title>'
    );
    expect((await prepareMusicXmlImport(new File([movement], 'fallback.musicxml'))).title)
      .toBe('Movement Name');
    const filenameOnly = movement.replace('<movement-title>Movement Name</movement-title>', '');
    expect((await prepareMusicXmlImport(new File([filenameOnly], 'Fallback Name.XML'))).title)
      .toBe('Fallback Name');
  });

  it('blocks documents with no TAB part or structural errors', async () => {
    const noTab = multipart.replaceAll('<sign>TAB</sign>', '<sign>G</sign>');
    await expect(prepareMusicXmlImport(new File([noTab], 'vocal.musicxml'))).rejects.toThrow(/TAB/);
    const invalidString = multipart.replace('<string>2</string>', '<string>8</string>');
    await expect(prepareMusicXmlImport(new File([invalidString], 'bad.musicxml'))).rejects.toThrow(/오류|error/i);
  });

  it('atomically imports only after a valid selected part is confirmed', async () => {
    const st = storageWith();
    useStorage(st);
    load();
    const previousId = library.currentId;
    const prepared = await prepareMusicXmlImport(new File([multipart], 'fallback.musicxml'));

    expect(() => importMusicXmlSong({ ...prepared, selectedPartId: 'missing' })).toThrow(/part/i);
    expect(library.currentId).toBe(previousId);
    expect(() => importMusicXmlSong({ ...prepared, selectedPartId: 'P1' })).toThrow(/TAB/);
    expect(library.currentId).toBe(previousId);
    const song = importMusicXmlSong({ ...prepared, selectedPartId: 'P2' });

    expect(song).toMatchObject({ selectedPartId: 'P2', title: 'Multipart Test', editorMode: 'musicxml-score' });
    expect(currentSong()).toBe(song);
    expect(state.viewMode).toBe('score');
    expect(JSON.parse(st.value()).songs[song.id].musicxml).toContain('keep gt2 verbatim');
  });

  it('downloads XML and MXL using a temporary object URL and revokes it later', () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    const schedule = vi.fn((fn) => fn());
    const clicked = vi.fn();
    const originalCreate = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      const element = originalCreate(tag, options);
      if (tag === 'a') element.click = clicked;
      return element;
    });

    const xmlResult = createMusicXmlDownload({
      xml: multipart, title: 'A:/ unsafe* title', format: 'xml',
      urlApi: { createObjectURL, revokeObjectURL }, schedule
    });
    const mxlResult = createMusicXmlDownload({
      xml: multipart, title: 'A:/ unsafe* title', format: 'mxl',
      urlApi: { createObjectURL, revokeObjectURL }, schedule
    });

    expect(xmlResult.filename).toBe('A unsafe title.musicxml');
    expect(xmlResult.blob.type).toBe('application/vnd.recordare.musicxml+xml');
    expect(mxlResult.filename).toBe('A unsafe title.mxl');
    expect(mxlResult.blob.type).toBe('application/vnd.recordare.musicxml');
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(schedule).toHaveBeenCalledTimes(2);
    createElement.mockRestore();
  });

  it('still revokes the object URL when the download anchor cannot be attached', () => {
    const revokeObjectURL = vi.fn();
    const schedule = vi.fn((fn) => fn());
    const anchor = { remove: vi.fn() };
    const documentRef = { createElement: () => anchor, body: { appendChild: () => { throw new Error('blocked'); } } };
    expect(() => createMusicXmlDownload({
      xml: multipart, title: 'score', format: 'xml', documentRef,
      urlApi: { createObjectURL: () => 'blob:blocked', revokeObjectURL }, schedule
    })).toThrow('blocked');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:blocked');
  });

  it('sanitizes blank and reserved score filenames', () => {
    expect(sanitizeScoreFilename('  <>:"/\\|?*  ')).toBe('score');
    expect(sanitizeScoreFilename('CON')).toBe('score-CON');
  });

  it('waits for an explicit accessible part choice and confirmation before commit', async () => {
    document.body.innerHTML = `
      <input id="file" type="file">
      <div id="choice" hidden role="dialog" aria-labelledby="choiceTitle">
        <h2 id="choiceTitle">TAB 파트 선택</h2><div id="parts"></div>
        <p id="status" role="status"></p><button id="cancel">취소</button><button id="confirm">확인</button>
      </div>`;
    const commit = vi.fn((value) => value);
    const onImported = vi.fn();
    const controller = createMusicXmlImportController({
      input: document.querySelector('#file'), dialog: document.querySelector('#choice'),
      partsHost: document.querySelector('#parts'), status: document.querySelector('#status'),
      confirm: document.querySelector('#confirm'), cancel: document.querySelector('#cancel'),
      commit, onImported
    });

    await controller.stage(new File([multipart], 'band.musicxml'));
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector('#choice').hidden).toBe(false);
    expect([...document.querySelectorAll('input[name="musicxml-part"]')].map((node) => node.value))
      .toEqual(['P2', 'P3']);
    expect(document.querySelector('input[name="musicxml-part"]:checked')).toBeNull();

    document.querySelector('input[value="P2"]').checked = true;
    document.querySelector('#confirm').click();
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ selectedPartId: 'P2' }));
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#choice').hidden).toBe(true);
  });

  it('cancels or reports import errors without committing staged data', async () => {
    document.body.innerHTML = `
      <input id="file"><div id="choice" hidden><div id="parts"></div><p id="status"></p>
      <button id="cancel">취소</button><button id="confirm">확인</button></div>`;
    const commit = vi.fn();
    const onError = vi.fn();
    const controller = createMusicXmlImportController({
      input: document.querySelector('#file'), dialog: document.querySelector('#choice'),
      partsHost: document.querySelector('#parts'), status: document.querySelector('#status'),
      confirm: document.querySelector('#confirm'), cancel: document.querySelector('#cancel'), commit, onError
    });
    await controller.stage(new File([multipart], 'band.musicxml'));
    document.querySelector('#cancel').click();
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector('#choice').hidden).toBe(true);

    await controller.stage(new File(['not xml'], 'bad.xml'));
    expect(commit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#status').textContent).toMatch(/MusicXML/);
  });
});
