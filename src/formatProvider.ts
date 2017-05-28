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
    private _isMultilineNameList = false;
    private _isMultilineCommaDelimitedListStack:boolean[];

    constructor(
        public doc: ParsedDocument,
        public indent: number,
        public formatOptions: lsp.FormattingOptions) {
        this._edits = [];
        this._isMultilineCommaDelimitedListStack = [];
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine[spine.length - 1] as Phrase;

        switch ((<Phrase>node).phraseType) {
            case PhraseType.FunctionDeclarationBody:
                if (parent.phraseType === PhraseType.AnonymousFunctionCreationExpression) {
                    return true;
                }
            // fall through
            case PhraseType.MethodDeclarationBody:
            case PhraseType.ClassDeclarationBody:
            case PhraseType.TraitDeclarationBody:
            case PhraseType.InterfaceDeclarationBody:
                this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                return true;

            case PhraseType.ExpressionStatement:
            case PhraseType.DoStatement:
            case PhraseType.IfStatement:
            case PhraseType.BreakStatement:
            case PhraseType.CaseStatement:
            case PhraseType.ContinueStatement:
            case PhraseType.DeclareStatement:
            case PhraseType.DefaultStatement:
            case PhraseType.ForeachStatement:
            case PhraseType.ForStatement:
            case PhraseType.GotoStatement:
            case PhraseType.HaltCompilerStatement:
            case PhraseType.NamedLabelStatement:
            case PhraseType.NullStatement:
            case PhraseType.ReturnStatement:
            case PhraseType.SwitchStatement:
            case PhraseType.ThrowStatement:
            case PhraseType.TryStatement:
            case PhraseType.WhileStatement:
                if (!this._nextFormatRule) {
                    this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                }
                return true;

            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.QualifiedName:
                if (
                    parent.phraseType === PhraseType.QualifiedNameList &&
                    ((this._previousToken &&
                        this._previousToken.tokenType === TokenType.Whitespace &&
                        FormatVisitor.countNewlines(this.doc.tokenText(this._previousToken)) > 0) ||
                        this._hasNewlineWhitespaceChild(parent))
                ) {
                    this._nextFormatRule = FormatVisitor.newlineIndentPlusOneBefore;
                }
                return true;

            case PhraseType.ParameterDeclarationList:
            case PhraseType.ArgumentExpressionList:
            case PhraseType.ClosureUseList:
            case PhraseType.QualifiedNameList:
                

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
            case TokenType.Comma:
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

            case TokenType.ElseIf:
            case TokenType.Else:
                if (!rule) {
                    if (this._hasColonChild(parent)) {
                        rule = FormatVisitor.newlineIndentBefore;
                    } else {
                        rule = FormatVisitor.singleSpaceBefore;
                    }
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

            case TokenType.Extends:
            case TokenType.Implements:
                rule = FormatVisitor.singleSpaceBefore;
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

        let parent = (spine.length ? spine[spine.length - 1] : null) as Phrase;

        switch ((<Phrase>node).phraseType) {
            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
                --this.indent;
                return;
            case PhraseType.NamespaceDefinition:
                this._nextFormatRule = FormatVisitor.doubleNewlineIndentBefore;
                return;
            case PhraseType.NamespaceUseDeclaration:
                if (this._isLastNamespaceUseDeclaration(parent, <Phrase>node)) {
                    this._nextFormatRule = FormatVisitor.doubleNewlineIndentBefore;
                }
                return;
            default:
                break;
        }

        switch ((<Token>node).tokenType) {
            case TokenType.OpenParenthesis:
            case TokenType.OpenBracket:
                this._nextFormatRule = FormatVisitor.noSpaceOrNewlineIndentBefore;
                ++this.indent;
                break;

            case TokenType.OpenBrace:
                this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                ++this.indent;
                break;

            case TokenType.Colon:
                if (this._shouldIndentAfterColon(<Phrase>spine[spine.length - 1])) {
                    ++this.indent;
                }
                break;

            case TokenType.Backslash:
                this._nextFormatRule = FormatVisitor.noSpaceBefore;
                break;

            case TokenType.Class:
                this._nextFormatRule = FormatVisitor.singleSpaceBefore;
                break;

            case TokenType.Extends:
                if (parent.phraseType === PhraseType.ClassBaseClause) {
                    this._nextFormatRule = FormatVisitor.singleSpaceBefore;
                }
                break;

            case TokenType.Ampersand:
                if(parent.phraseType !== PhraseType.BitwiseExpression){
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                break;

            case TokenType.Plus:
            case TokenType.Minus:
                if(parent.phraseType === PhraseType.UnaryOpExpression){
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                break;

            case TokenType.PlusPlus:
                if (parent.phraseType === PhraseType.PrefixIncrementExpression) {
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                break;

            case TokenType.MinusMinus:
                if (parent.phraseType === PhraseType.PrefixDecrementExpression) {
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                break;

            case TokenType.Ellipsis:
            case TokenType.Exclamation:
            case TokenType.AtSymbol:
            case TokenType.ArrayCast:
            case TokenType.BooleanCast:
            case TokenType.FloatCast:
            case TokenType.IntegerCast:
            case TokenType.ObjectCast:
            case TokenType.StringCast:
            case TokenType.UnsetCast:
            case TokenType.Tilde:
                this._nextFormatRule = FormatVisitor.noSpaceBefore;
                break;

            default:
                break;

        }

    }

    private _hasNewlineWhitespaceChild(phrase: Phrase) {
        for (let n = 0, l = phrase.children.length; n < l; ++n) {
            if (
                (<Token>phrase.children[n]).tokenType === TokenType.Whitespace &&
                FormatVisitor.countNewlines(this.doc.tokenText(<Token>phrase.children[n])) > 0
            ) {
                return true;
            }
        }
        return false;
    }

    private _isLastNamespaceUseDeclaration(parent: Phrase, child: Phrase) {

        let i = parent.children.indexOf(child);
        while (i < parent.children.length) {
            ++i;
            child = parent.children[i] as Phrase;
            if (child.phraseType) {
                return child.phraseType !== PhraseType.NamespaceUseDeclaration;
            }
        }

        return true;

    }

    private _shouldIndentAfterColon(parent: Phrase) {
        switch (parent.phraseType) {
            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
                return true;
            default:
                return false;
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

    private _hasColonChild(phrase: Phrase) {

        for (let n = 0, l = phrase.children.length; n < l; ++n) {
            if ((<Token>phrase.children[n]).tokenType === TokenType.Colon) {
                return true;
            }
        }
        return false;

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

    export function noSpaceOrNewlineIndentBefore(previous: Token, doc: ParsedDocument, formatOptions: lsp.FormattingOptions, indent: number): lsp.TextEdit {
        if (previous.tokenType !== TokenType.Whitespace) {
            return null;
        }

        let actualWs = doc.tokenText(previous);
        let newlineCount = countNewlines(actualWs);
        if (!newlineCount) {
            return lsp.TextEdit.del(doc.tokenRange(previous));
        }

        let expectedWs = createWhitespace(newlineCount, '\n') + createIndentText(indent, formatOptions);
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

    export function countNewlines(text: string) {

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
