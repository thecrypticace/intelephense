/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { TreeVisitor } from './types'
import {
    Phrase, Token, PhraseType, TokenType,
    CompoundStatement
} from 'php7parser';
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

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {

            case PhraseType.StatementList:
                //newline + indent between statements
                Array.prototype.push.apply(this._edits, this._statementList(<Phrase>node));
                break;
            case PhraseType.AdditiveExpression:
            case PhraseType.MultiplicativeExpression:
            case PhraseType.BitwiseExpression:
            case PhraseType.CloneExpression:
            case PhraseType.CoalesceExpression:
            case PhraseType.CompoundAssignmentExpression:
            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.EqualityExpression:
            case PhraseType.ExponentiationExpression:
            case PhraseType.InstanceOfExpression:
            case PhraseType.LogicalExpression:
            case PhraseType.ShiftExpression:
                //single whitespace between operators and operands
                Array.prototype.push.apply(this._edits, this._whitespaceBetween(
                    <Phrase>node, ' ', [TokenType.Whitespace]
                ));
                break;

            case PhraseType.ByRefAssignmentExpression:

                break;

            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
            case PhraseType.ClassDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.TraitDeclaration:
                //newline + indent between header and body
                Array.prototype.push.apply(this._edits, this._whitespaceBetween(
                    <Phrase>node, this._newLineIndent(1), [TokenType.Whitespace, TokenType.Comment]
                ));
                break;

            case PhraseType.CompoundStatement:
            case PhraseType.FunctionDeclarationBody:
                //newline + ident after { and before }
                ++this.indent;
                break;




        }

        return true;

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.CompoundStatement:
            case PhraseType.FunctionDeclarationBody:
                --this.indent;
                break;
            default:
                break;

        }

    }


    private _newLineIndent(newlineCount: number) {
        let ws = new Array(newlineCount).fill('\n').join('');
        if (this.formatOptions.insertSpaces) {
            ws += new Array(this.indent * this.formatOptions.tabSize).fill(' ').join('');
        } else {
            ws += new Array(this.indent).fill('\t').join('');
        }
        return ws;
    }

    private _countNewlines(text: string) {

        let c: string;
        let count = 0;
        let l = text.length;
        let n = 0;

        while (n < l) {
            c = text[n];
            ++n;
            if (c === '\r') {
                ++count;
                if (n < l && text[n] === '\n') {
                    ++n;
                }
            } else if (c === '\n') {
                ++count;
            }

        }

        return count;

    }

}
