/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { TreeVisitor } from './types'
import { Phrase, Token, PhraseType, TokenType } from 'php7parser';
import { ParsedDocument } from './parsedDocument';

export class FormatProvider {


    provideDocumentFormattingEdits(doc: lsp.TextDocumentIdentifier, formatOptions: lsp.FormattingOptions) {




    }


}


class FormatVisitor implements TreeVisitor<Phrase | Token> {

    private _edits: lsp.TextEdit[];

    constructor(
        public doc: ParsedDocument,
        public indent: number,
        public formatOptions: lsp.FormattingOptions) {
        this._edits = [];
    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {

            case PhraseType.StatementList:
                this._statementList(<Phrase>node);
                break;
            


        }

    }

    private _statementList(node: Phrase) {

        let child: Phrase | Token;
        let ws: Token;
        let edit: lsp.TextEdit;


        for (let n = 0, l = node.children.length; n < l; ++n) {
            child = node.children[n];
            if (n < 1 || !ParsedDocument.isPhrase(child)) {
                continue;
            }
            ws = node.children[n - 1] as Token;
            if (ParsedDocument.isToken(ws, [TokenType.Whitespace])) {
                edit = lsp.TextEdit.replace(this.doc.tokenRange(ws), this.indentString());
            } else {
                edit = lsp.TextEdit.insert(this.doc.nodeRange(child).start, this.indentString());
            }
            this._edits.push(edit);
        }

    }

    private indentString(){
        let ws = '\n';
        if(this.formatOptions.insertSpaces){
            ws += new Array(this.indent * this.formatOptions.tabSize).fill(' ').join('');
        } else {
            ws += new Array(this.indent).fill('\t').join('');
        }
        return ws;
    }

}