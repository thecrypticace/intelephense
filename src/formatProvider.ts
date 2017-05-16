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

interface FormatRule {
    (previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit;
}

export class FormatProvider {


    provideDocumentFormattingEdits(doc: lsp.TextDocumentIdentifier, formatOptions: lsp.FormattingOptions) {




    }


}

class FormatVisitor implements TreeVisitor<Phrase | Token> {

    private _edits: lsp.TextEdit[];
    private _previousToken: Token;
    private _nextFormatRule: FormatRule;

    constructor(
        public doc: ParsedDocument,
        public indent: number,
        public formatOptions: lsp.FormattingOptions) {
        this._edits = [];
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine[spine.length - 1] as Phrase;

        switch ((<Phrase>node).phraseType) {
            case PhraseType.FunctionDeclarationBody:
                if (parent.phraseType === PhraseType.AnonymousFunctionCreationExpression) {
                    break;
                }
            // fall through
            case PhraseType.MethodDeclarationBody:
            case PhraseType.ClassDeclarationBody:
            case PhraseType.TraitDeclarationBody:
            case PhraseType.InterfaceDeclarationBody:
                this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                return true;

            case undefined:
                //tokens
                break;
            default:
                return true;
        }

        let rule = this._nextFormatRule;
        let previous = this._previousToken;
        this._previousToken = node as Token;
        this._nextFormatRule = null;

        switch ((<Token>node).tokenType) {

            case TokenType.Whitespace:

                this._nextFormatRule = rule;
                break;
            case TokenType.Comment:

                this._nextFormatRule = rule;
                break;
            case TokenType.DocumentComment:
                break;
            case TokenType.Semicolon:
                rule = FormatVisitor.noSpaceBefore;
                break;

            case TokenType.OpenParenthesis:
                if (rule) {
                    break;
                }

                if (this._shouldOpenParenthesisHaveNoSpaceBefore(parent)) {
                    rule = FormatVisitor.noSpaceBefore;
                } else {
                    rule = FormatVisitor.singleSpaceBefore;
                }
                break;

            case TokenType.OpenBrace:
                if (!rule) {
                    rule = FormatVisitor.singleSpaceBefore;
                }
                break;
            case TokenType.CloseBrace:
            case TokenType.CloseBracket:
            case TokenType.CloseParenthesis:
                --this.indent;
                break;
            default:
                if (!rule) {
                    rule = FormatVisitor.singleSpaceOrNewlineIndentPlusOneBefore;
                }
                break;
        }

        let edit = rule(previous, this.doc, this.formatOptions, this.indent);
        if (edit) {
            this._edits.push(edit);
        }
        return false;
    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Token>node).tokenType) {
            case TokenType.OpenParenthesis:
            case TokenType.OpenBracket:
            case TokenType.OpenBrace:
                ++this.indent;
                break;
            default:
                break;

        }

    }

    private _shouldOpenParenthesisHaveNoSpaceBefore(parent: Phrase) {
        switch (parent.phraseType) {
            case PhraseType.FunctionCallExpression:
            case PhraseType.MethodCallExpression:
            case PhraseType.ScopedCallExpression:
            case PhraseType.EchoIntrinsic:
            case PhraseType.EmptyIntrinsic:
            case PhraseType.EvalIntrinsic:
            case PhraseType.ExitIntrinsic:
            case PhraseType.IssetIntrinsic:
            case PhraseType.ListIntrinsic:
            case PhraseType.PrintIntrinsic:
            case PhraseType.UnsetIntrinsic:
            case PhraseType.ArrayCreationExpression:
                return true;
            default:
                return false;
        }
    }


}

namespace FormatVisitor {

    export function singleSpaceBefore(previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit {
        if (previous.tokenType !== TokenType.Whitespace) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length + 1), ' ');
        }

        let actualWs = doc.tokenText(previous);
        let expectedWs = ' ';
        if (actualWs === expectedWs) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);
    }

    export function newlineIndentBefore(previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit {
        if (previous.tokenType !== TokenType.Whitespace) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length + 1), '\n' + createIndentText(indent, formatOptions));
        }

        let actualWs = doc.tokenText(previous);
        let expectedWs = createWhitespace(Math.max(1, countNewlines(actualWs)), '\n') + createIndentText(indent, formatOptions);
        if (actualWs === expectedWs) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);
    }

    export function newlineIndentPlusOneBefore(previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit {
        if (previous.tokenType !== TokenType.Whitespace) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length + 1), '\n' + createIndentText(indent + 1, formatOptions));
        }

        let actualWs = doc.tokenText(previous);
        let expectedWs = createWhitespace(Math.max(1, countNewlines(actualWs)), '\n') + createIndentText(indent + 1, formatOptions);
        if (actualWs === expectedWs) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);
    }

    export function doubleNewlineIndentBefore(previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit {
        if (previous.tokenType !== TokenType.Whitespace) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length + 1), '\n\n' + createIndentText(indent, formatOptions));
        }

        let actualWs = doc.tokenText(previous);
        let expected = createWhitespace(Math.max(2, countNewlines(actualWs)), '\n') + createIndentText(indent, formatOptions);
        if (actualWs === expected) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expected);
    }

    export function noSpaceBefore(previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit {
        if (previous.tokenType !== TokenType.Whitespace) {
            return null;
        }
        return lsp.TextEdit.del(doc.tokenRange(previous));
    }

    export function noSpaceOrNewlineIndentPlusOneBefore(previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit {
        if (previous.tokenType !== TokenType.Whitespace) {
            return null;
        }

        let actualWs = doc.tokenText(previous);
        let newlineCount = countNewlines(actualWs);
        if (!newlineCount) {
            return lsp.TextEdit.del(doc.tokenRange(previous));
        }

        let expectedWs = createWhitespace(newlineCount, '\n') + createIndentText(indent + 1, formatOptions);
        if (actualWs === expectedWs) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);

    }

    export function singleSpaceOrNewlineIndentPlusOneBefore(previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit {

        if (previous.tokenType !== TokenType.Whitespace) {
            return lsp.TextEdit.insert(this.doc.positionAtOffset(previous.offset + previous.length + 1), ' ');
        }

        let actualWs = doc.tokenText(previous);
        if (actualWs === ' ') {
            return null;
        }

        let newlineCount = countNewlines(actualWs);
        if (!newlineCount) {
            return lsp.TextEdit.replace(doc.tokenRange(previous), ' ');
        }

        let expectedWs = createWhitespace(newlineCount, '\n') + createIndentText(indent + 1, formatOptions);
        if (actualWs !== expectedWs) {
            return lsp.TextEdit.replace(doc.tokenRange(this._previousToken), expectedWs);
        }

        return null;

    }

    function createIndentText(indentCount: number, formatOptions: lsp.FormattingOptions) {
        if (formatOptions.insertSpaces) {
            return createWhitespace(indentCount * formatOptions.tabSize, ' ');
        } else {
            return createWhitespace(indentCount, '\t');
        }
    }

    function createWhitespace(n: number, chr: string) {
        let text = '';
        while (n > 0) {
            text += chr;
            --n;
        }
        return text;
    }

    function countNewlines(text: string) {

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
