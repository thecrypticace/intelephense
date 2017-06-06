/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {
    Phrase, Token, NamespaceName, MemberName, TokenType,
    PhraseType, NamespaceDefinition, Parser, SimpleVariable,
    ScopedMemberName
} from 'php7parser';
import { TextDocument } from './textDocument';
import * as lsp from 'vscode-languageserver-types';
import {
    TreeVisitor, TreeTraverser, Event, Debounce, Unsubscribe,
    Predicate, Traversable
} from './types';

const textDocumentChangeDebounceWait = 250;

export interface ParsedDocumentChangeEventArgs {
    parsedDocument: ParsedDocument;
}

export class ParsedDocument implements Traversable<Phrase | Token>{

    private static _wordRegex = /[$a-zA-Z_\x80-\xff][\\a-zA-Z0-9_\x80-\xff]*$/;
    private _textDocument: TextDocument;
    private _parseTree: Phrase;
    private _changeEvent: Event<ParsedDocumentChangeEventArgs>;
    private _debounce: Debounce<null>;
    private _reparse = (x) => {
        this._parseTree = Parser.parse(this._textDocument.text);
        this._changeEvent.trigger({ parsedDocument: this });
    };

    constructor(uri: string, text: string) {
        this._parseTree = Parser.parse(text);
        this._textDocument = new TextDocument(uri, text);
        this._debounce = new Debounce<null>(this._reparse, textDocumentChangeDebounceWait);
        this._changeEvent = new Event<ParsedDocumentChangeEventArgs>();
    }

    get tree() {
        return this._parseTree;
    }

    get uri() {
        return this._textDocument.uri;
    }

    get changeEvent() {
        return this._changeEvent;
    }

    find(predicate: Predicate<Phrase | Token>) {
        let traverser = new TreeTraverser([this._parseTree]);
        return traverser.find(predicate);
    }

    textBeforeOffset(offset: number, length: number) {
        return this._textDocument.textBeforeOffset(offset, length);
    }

    lineSubstring(offset: number) {
        return this._textDocument.lineSubstring(offset);
    }

    wordAtOffset(offset: number) {
        let lineText = this._textDocument.lineSubstring(offset);
        let match = lineText.match(ParsedDocument._wordRegex);
        return match ? match[0] : '';
    }

    flush() {
        this._debounce.flush();
    }

    traverse(visitor: TreeVisitor<Phrase | Token>) {
        let traverser = new TreeTraverser<Phrase | Token>([this._parseTree]);
        traverser.traverse(visitor);
        return visitor;
    }

    createTraverser() {
        return new TreeTraverser<Phrase | Token>([this._parseTree]);
    }

    applyChanges(contentChanges: lsp.TextDocumentContentChangeEvent[]) {

        let change: lsp.TextDocumentContentChangeEvent;

        for (let n = 0, l = contentChanges.length; n < l; ++n) {
            change = contentChanges[n];
            this._textDocument.applyEdit(change.range.start, change.range.end, change.text);
        }

        this._debounce.handle(null);

    }

    tokenRange(t: Token) {
        if (!t) {
            return null;
        }

        let r = <lsp.Range>{
            start: this._textDocument.positionAtOffset(t.offset),
            end: this._textDocument.positionAtOffset(t.offset + t.length)
        }

        return r;
    }

    nodeLocation(node: Phrase | Token) {
        if (!node) {
            return null;
        }

        let range = this.nodeRange(node);

        if (!range) {
            return null;
        }

        return <lsp.Location>{
            uri: this.uri,
            range: range
        }
    }

    nodeRange(node: Phrase | Token) {

        if (!node) {
            return null;
        }

        if (ParsedDocument.isToken(node)) {
            return this.tokenRange(<Token>node);
        }

        let tFirst = ParsedDocument.firstToken(node);
        let tLast = ParsedDocument.lastToken(node);

        if (!tFirst || !tLast) {
            return null;
        }

        let range = <lsp.Range>{
            start: this._textDocument.positionAtOffset(tFirst.offset),
            end: this._textDocument.positionAtOffset(tLast.offset + tLast.length)
        }

        return range;

    }

    tokenText(t: Token) {
        return ParsedDocument.isToken(t) ? this._textDocument.textAtOffset(t.offset, t.length) : '';
    }

    nodeText(node: Phrase | Token, ignore?: TokenType[]) {

        if (!node) {
            return '';
        }

        if (ParsedDocument.isToken(node)) {
            return this.tokenText(<Token>node);
        }

        let visitor = new ToStringVisitor(this, ignore);
        let traverser = new TreeTraverser([node]);
        traverser.traverse(visitor);
        return visitor.text;
    }

    createAnonymousName(node: Phrase) {
        let tFirst = ParsedDocument.firstToken(node);
        let offset = tFirst ? tFirst.offset : 0;
        return `#anonymous#${this.uri}#${offset}`;
    }

    positionAtOffset(offset: number) {
        return this._textDocument.positionAtOffset(offset);
    }

    offsetAtPosition(position: lsp.Position) {
        return this._textDocument.offsetAtPosition(position);
    }

    namespaceNamePhraseToString(node: Phrase | Token) {

        if (!ParsedDocument.isPhrase(node, [PhraseType.NamespaceName])) {
            return '';
        }

        return this.nodeText(node, [TokenType.Comment, TokenType.Whitespace]);

    }

}

export namespace ParsedDocument {

    export function firstToken(node: Phrase | Token) {

        if (ParsedDocument.isToken(node)) {
            return node as Token;
        }

        let t: Token;
        for (let n = 0, l = (<Phrase>node).children.length; n < l; ++n) {
            t = this.firstToken((<Phrase>node).children[n]);
            if (t !== null) {
                return t;
            }
        }

        return null;
    }

    export function lastToken(node: Phrase | Token) {
        if (ParsedDocument.isToken(node)) {
            return node as Token;
        }

        let t: Token;
        for (let n = (<Phrase>node).children.length - 1; n >= 0; --n) {
            t = this.lastToken((<Phrase>node).children[n]);
            if (t !== null) {
                return t;
            }
        }

        return null;
    }

    export function isToken(node: Phrase | Token, types?: TokenType[]) {
        return node && (<Token>node).tokenType !== undefined &&
            (!types || types.indexOf((<Token>node).tokenType) > -1);
    }

    export function isPhrase(node: Phrase | Token, types?: PhraseType[]) {
        return node && (<Phrase>node).phraseType !== undefined &&
            (!types || types.indexOf((<Phrase>node).phraseType) > -1);
    }

    export function isOffsetInToken(offset: number, t: Token) {
        return offset > -1 && ParsedDocument.isToken(t) &&
            t.offset <= offset &&
            t.offset + t.length - 1 >= offset;
    }

    export function isOffsetInNode(offset, node: Phrase | Token) {

        if (!node || offset < 0) {
            return false;
        }

        if (ParsedDocument.isToken(node)) {
            return ParsedDocument.isOffsetInToken(offset, <Token>node);
        }

        let tFirst = ParsedDocument.firstToken(node);
        let tLast = ParsedDocument.lastToken(node);

        if (!tFirst || !tLast) {
            return false;
        }

        return tFirst.offset <= offset && tLast.offset + tLast.length - 1 >= offset;

    }

    export function isFixedMemberName(phrase: MemberName) {
        return ParsedDocument.isPhrase(phrase, [PhraseType.MemberName]) &&
            ParsedDocument.isToken(phrase.name, [TokenType.Name]);
    }

    export function isFixedSimpleVariable(phrase: SimpleVariable) {
        return ParsedDocument.isPhrase(phrase, [PhraseType.SimpleVariable]) &&
            ParsedDocument.isToken(phrase.name, [TokenType.VariableName]);
    }

    export function isFixedScopedMemberName(phrase: ScopedMemberName) {
        return ParsedDocument.isPhrase(phrase, [PhraseType.ScopedMemberName]) &&
            (ParsedDocument.isToken(phrase.name, [TokenType.VariableName]) ||
                ParsedDocument.isPhrase(phrase.name, [PhraseType.Identifier]));
    }

    const nodeKeys = [
        'tokenType', 'offset', 'length', 'modeStack',
        'phraseType', 'children', 'errors', 'unexpected',
        'numberSkipped'
    ];

    function isNumeric(n) {
        return !isNaN(parseFloat(n)) && isFinite(n);
    }

    export function stringyfyReplacer(k, v) {
        return k && !isNumeric(k) && nodeKeys.indexOf(k) < 0 ? undefined : v;
    }

    export function firstPhraseOfType(type: PhraseType, nodes: (Phrase | Token)[]) {

        let child: Phrase;
        for (let n = 0, l = nodes.length; n < l; ++n) {
            child = nodes[n] as Phrase;
            if (child.phraseType === type) {
                return child;
            }
        }
        return null;
    }

    export function isNamePhrase(node:Phrase|Token) {
        if(!node){
            return false;
        }

        switch((<Phrase>node).phraseType){
            case PhraseType.QualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.FullyQualifiedName:
                return true;
            default:
                return false;
        }
    } 

}

export class ParsedDocumentStore {

    private _parsedDocumentChangeEvent: Event<ParsedDocumentChangeEventArgs>;
    private _parsedDocumentmap: { [index: string]: ParsedDocument };
    private _unsubscribeMap: { [index: string]: Unsubscribe };
    private _bubbleEvent = (args: ParsedDocumentChangeEventArgs) => {
        this._parsedDocumentChangeEvent.trigger(args);
    }

    constructor() {
        this._parsedDocumentmap = {};
        this._parsedDocumentChangeEvent = new Event<ParsedDocumentChangeEventArgs>();
        this._unsubscribeMap = {};
    }

    get parsedDocumentChangeEvent() {
        return this._parsedDocumentChangeEvent;
    }

    get count() {
        return Object.keys(this._parsedDocumentmap).length;
    }

    has(uri: string) {
        return this._parsedDocumentmap[uri] !== undefined;
    }

    add(parsedDocument: ParsedDocument) {
        if (this.has(parsedDocument.uri)) {
            throw new Error('Duplicate key');
        }

        this._parsedDocumentmap[parsedDocument.uri] = parsedDocument;
        this._unsubscribeMap[parsedDocument.uri] = parsedDocument.changeEvent.subscribe(this._bubbleEvent);
    }

    remove(uri: string) {

        if (!this.has(uri)) {
            return;
        }

        let unsubscribe = this._unsubscribeMap[uri];
        unsubscribe();
        delete this._parsedDocumentmap[uri];

    }

    find(uri: string) {
        return this._parsedDocumentmap[uri];
    }

}

class ToStringVisitor implements TreeVisitor<Phrase | Token> {

    private _text: string;
    private _doc: ParsedDocument;
    private _ignore: TokenType[];

    constructor(doc: ParsedDocument, ignore?: TokenType[]) {
        this._text = '';
        this._doc = doc;
    }

    get text() {
        return this._text;
    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (ParsedDocument.isToken(node) && (!this._ignore || this._ignore.indexOf((<Token>node).tokenType) < 0)) {
            this._text += this._doc.tokenText(<Token>node);
        }

    }

}
