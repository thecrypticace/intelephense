/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { ParsedDocument } from './parsedDocument';
import { TreeVisitor } from './types';
import { Phrase, Token, ParseError, tokenTypeToString } from 'php7parser';
import * as lsp from 'vscode-languageserver-types';

export class DiagnosticsProvider {

    diagnose(doc: ParsedDocument) {

        let diagnostics: lsp.Diagnostic[] = [];
        let parseErrorVisitor = new ErrorVisitor();
        doc.traverse(parseErrorVisitor);
        let parseErrors = parseErrorVisitor.errors;


        for (let n = 0, l = parseErrors.length; n < l; ++n) {
            diagnostics.push(this._parseErrorToDiagnostic(parseErrors[n], doc));
        }

        return diagnostics;

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

    preOrder(node: Token | Phrase, spine: (Token | Phrase)[]) {

        if (ParsedDocument.isPhrase(node) && (<Phrase>node).errors) {
            Array.prototype.push.apply(this._errors, (<Phrase>node).errors);
        }

        return true;

    }

}