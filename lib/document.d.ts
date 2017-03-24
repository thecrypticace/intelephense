import { Position } from 'vscode-languageserver-types';
export declare class TextDocument {
    private _uri;
    private _text;
    private _lineOffsets;
    constructor(uri: string, text: string);
    readonly uri: string;
    fullText: string;
    readonly lineOffsets: number[];
    textAtOffset(offset: number, length: number): string;
    positionAtOffset(offset: number): Position;
    offsetAtPosition(pos: Position): number;
    applyEdit(start: Position, end: Position, text: string): void;
    private _textLineOffsets(text, offset);
}
export declare class DocumentStore {
    private _documents;
    constructor();
    add(doc: TextDocument): void;
    remove(uri: string): void;
    find(uri: string): TextDocument;
}
