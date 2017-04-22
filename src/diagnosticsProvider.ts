/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { ParsedDocument, ParsedDocumentChangeEventArgs } from './parsedDocument';
import { TreeVisitor, Event, Debounce, Unsubscribe } from './types';
import { Phrase, Token, ParseError, tokenTypeToString } from 'php7parser';
import * as lsp from 'vscode-languageserver-types';

export interface PublishDiagnosticsEventArgs {
    uri: string;
    diagnostics: lsp.Diagnostic[];
}

export class DiagnosticsProvider {

    maxItems: number;

    private _docs: { [index: string]: ParsedDocument };
    private _debounceWaitTime: number;
    private _publish: Event<PublishDiagnosticsEventArgs>;
    private _startDiagnostics: Event<string>;
    private _debounceMap: { [index: string]: Debounce<ParsedDocumentChangeEventArgs> };
    private _unsubscribeMap: { [index: string]: Unsubscribe };
    private _maxItems: number;

    private _onParsedDocumentChanged = (args: ParsedDocumentChangeEventArgs) => {
        this._startDiagnostics.trigger(args.parsedDocument.uri);
        let diagnostics = this._diagnose(args.parsedDocument.uri);
        this._publish.trigger({ uri: args.parsedDocument.uri, diagnostics: diagnostics });
    };

    constructor() {
        this._debounceWaitTime = 1000;
        this._docs = {};
        this._publish = new Event<PublishDiagnosticsEventArgs>();
        this._startDiagnostics = new Event<string>();
        this._debounceMap = {};
        this._unsubscribeMap = {};
        this.maxItems = 100;
    }

    get startDiagnosticsEvent() {
        return this._startDiagnostics;
    }

    get publishDiagnosticsEvent() {
        return this._publish;
    }

    add(doc: ParsedDocument) {
        if (this.has(doc.uri)) {
            throw new Error('Duplicate Key');
        }

        this._docs[doc.uri] = doc;

        let dd = this._debounceMap[doc.uri] = new Debounce<ParsedDocumentChangeEventArgs>(
            this._onParsedDocumentChanged,
            this._debounceWaitTime
        );

        this._unsubscribeMap[doc.uri] = doc.changeEvent.subscribe((x) => {
            dd.handle(x);
        });

    }

    remove(uri: string) {
        if (!this.has(uri)) {
            return;
        }

        this._unsubscribeMap[uri]();
        this._debounceMap[uri].clear();
        delete this._debounceMap[uri];
        delete this._unsubscribeMap[uri];
        delete this._docs[uri];

    }

    has(uri: string) {
        return this._docs[uri] !== undefined;
    }

    set debounceWait(value: number) {
        this._debounceWaitTime = value;
        let keys = Object.keys(this._debounceMap);
        for (let n = 0, l = keys.length; n < l; ++n) {
            this._debounceMap[keys[n]].wait = this._debounceWaitTime;
        }
    }

    private _diagnose(uri: string) {

        let diagnostics: lsp.Diagnostic[] = [];
        let parseErrorVisitor = new ErrorVisitor();
        let doc = this._docs[uri];

        if(!doc){
            return [];
        }

        doc.traverse(parseErrorVisitor);
        let parseErrors = parseErrorVisitor.errors;

        for (let n = 0, l = parseErrors.length; n < l; ++n) {
            diagnostics.push(this._parseErrorToDiagnostic(parseErrors[n], doc));
        }

        return diagnostics.slice(0, this._maxItems);

    }

    private _parseErrorToDiagnostic(err: ParseError, doc: ParsedDocument) {
        return <lsp.Diagnostic>{
            range: doc.tokenRange(err.unexpected),
            severity: lsp.DiagnosticSeverity.Error,
            source: 'intelephense',
            message: `Unexpected ${tokenTypeToString(err.unexpected.tokenType)}`,
        };
    }


}

class ErrorVisitor implements TreeVisitor<Phrase | Token>{

    private _errors: ParseError[];

    constructor() {
        this._errors = [];
    }

    get errors() {
        return this._errors;
    }

    preorder(node: Token | Phrase, spine: (Token | Phrase)[]) {

        if (ParsedDocument.isPhrase(node) && (<Phrase>node).errors) {
            Array.prototype.push.apply(this._errors, (<Phrase>node).errors);
        }

        return true;

    }

}