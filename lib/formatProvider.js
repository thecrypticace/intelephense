/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const lsp = require("vscode-languageserver-types");
class FormatProvider {
    constructor(docStore) {
        this.docStore = docStore;
    }
    provideDocumentFormattingEdits(doc, formatOptions) {
        let parsedDoc = this.docStore.find(doc.uri);
        if (!parsedDoc) {
            return [];
        }
        let visitor = new FormatVisitor(parsedDoc, formatOptions);
        parsedDoc.traverse(visitor);
        return visitor.edits;
    }
}
exports.FormatProvider = FormatProvider;
class FormatVisitor {
    constructor(doc, formatOptions) {
        this.doc = doc;
        this.formatOptions = formatOptions;
        this._indentText = '';
        this._edits = [];
        this._isMultilineCommaDelimitedListStack = [];
        this._indentUnit = formatOptions.insertSpaces ? FormatVisitor.createWhitespace(formatOptions.tabSize, ' ') : '\t';
    }
    get edits() {
        return this._edits.reverse();
    }
    preorder(node, spine) {
        let parent = spine[spine.length - 1];
        switch (node.phraseType) {
            //newline indent before {
            case 86 /* FunctionDeclarationBody */:
                if (parent.phraseType === 4 /* AnonymousFunctionCreationExpression */) {
                    return true;
                }
            // fall through
            case 113 /* MethodDeclarationBody */:
            case 29 /* ClassDeclarationBody */:
            case 165 /* TraitDeclarationBody */:
            case 103 /* InterfaceDeclarationBody */:
                this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                return true;
            //comma delim lists
            case 129 /* ParameterDeclarationList */:
            case 8 /* ArgumentExpressionList */:
            case 36 /* ClosureUseList */:
            case 11 /* ArrayInitialiserList */:
            case 141 /* QualifiedNameList */:
                this._incrementIndent();
                if ((this._previousToken &&
                    this._previousToken.tokenType === 161 /* Whitespace */ &&
                    FormatVisitor.countNewlines(this.doc.tokenText(this._previousToken)) > 0) ||
                    this._hasNewlineWhitespaceChild(node)) {
                    this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                    this._isMultilineCommaDelimitedListStack.push(true);
                }
                else {
                    this._isMultilineCommaDelimitedListStack.push(false);
                    if (node.phraseType !== 141 /* QualifiedNameList */) {
                        this._nextFormatRule = FormatVisitor.noSpaceBefore;
                    }
                }
                return true;
            case 58 /* EncapsulatedVariableList */:
                this._nextFormatRule = FormatVisitor.noSpaceBefore;
                return true;
            case 155 /* SimpleVariable */:
                if (parent.phraseType === 58 /* EncapsulatedVariableList */) {
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                return true;
            case undefined:
                //tokens
                break;
            default:
                return true;
        }
        let rule = this._nextFormatRule;
        let previous = this._previousToken;
        this._previousToken = node;
        this._nextFormatRule = null;
        if (!previous) {
            return false;
        }
        switch (node.tokenType) {
            case 161 /* Whitespace */:
            case 159 /* Comment */:
                this._nextFormatRule = rule;
                return false;
            case 160 /* DocumentComment */:
                rule = FormatVisitor.newlineIndentBefore;
                break;
            case 135 /* PlusPlus */:
                if (parent.phraseType === 131 /* PostfixIncrementExpression */) {
                    rule = FormatVisitor.noSpaceBefore;
                }
                break;
            case 129 /* MinusMinus */:
                if (parent.phraseType === 130 /* PostfixDecrementExpression */) {
                    rule = FormatVisitor.noSpaceBefore;
                }
                break;
            case 88 /* Semicolon */:
            case 93 /* Comma */:
            case 81 /* Text */:
            case 156 /* OpenTag */:
            case 157 /* OpenTagEcho */:
            case 80 /* EncapsulatedAndWhitespace */:
            case 131 /* DollarCurlyOpen */:
            case 128 /* CurlyOpen */:
                rule = FormatVisitor.noSpaceBefore;
                break;
            case 115 /* Arrow */:
            case 133 /* ColonColon */:
                rule = FormatVisitor.noSpaceOrNewlineIndentPlusOneBefore;
                break;
            case 118 /* OpenParenthesis */:
                if (this._shouldOpenParenthesisHaveNoSpaceBefore(parent)) {
                    rule = FormatVisitor.noSpaceBefore;
                }
                else {
                    rule = FormatVisitor.singleSpaceBefore;
                }
                break;
            case 117 /* OpenBracket */:
                if (parent.phraseType === 159 /* SubscriptExpression */) {
                    rule = FormatVisitor.noSpaceBefore;
                }
                break;
            case 119 /* CloseBrace */:
                this._decrementIndent();
                if (parent.phraseType === 159 /* SubscriptExpression */ ||
                    parent.phraseType === 56 /* EncapsulatedExpression */ ||
                    parent.phraseType === 57 /* EncapsulatedVariable */) {
                    rule = FormatVisitor.noSpaceBefore;
                }
                else {
                    rule = FormatVisitor.newlineIndentBefore;
                }
                break;
            case 120 /* CloseBracket */:
            case 121 /* CloseParenthesis */:
                if (!rule) {
                    rule = FormatVisitor.noSpaceBefore;
                }
                break;
            default:
                break;
        }
        if (!rule) {
            rule = FormatVisitor.singleSpaceOrNewlineIndentPlusOneBefore;
        }
        let edit = rule(previous, this.doc, this._indentText, this._indentUnit);
        if (edit) {
            this._edits.push(edit);
        }
        return false;
    }
    postorder(node, spine) {
        let parent = spine[spine.length - 1];
        switch (node.phraseType) {
            case 17 /* CaseStatement */:
            case 48 /* DefaultStatement */:
                this._decrementIndent();
                return;
            case 119 /* NamespaceDefinition */:
                this._nextFormatRule = FormatVisitor.doubleNewlineIndentBefore;
                return;
            case 123 /* NamespaceUseDeclaration */:
                if (this._isLastNamespaceUseDeclaration(parent, node)) {
                    this._nextFormatRule = FormatVisitor.doubleNewlineIndentBefore;
                }
                return;
            case 129 /* ParameterDeclarationList */:
            case 8 /* ArgumentExpressionList */:
            case 36 /* ClosureUseList */:
            case 141 /* QualifiedNameList */:
            case 11 /* ArrayInitialiserList */:
                this._decrementIndent();
                if (this._isMultilineCommaDelimitedListStack.pop()) {
                    this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                }
                return;
            case 27 /* ClassConstElementList */:
            case 44 /* ConstElementList */:
            case 138 /* PropertyElementList */:
                this._decrementIndent();
                this._isMultilineCommaDelimitedListStack.pop();
                return;
            case 58 /* EncapsulatedVariableList */:
                this._nextFormatRule = FormatVisitor.noSpaceBefore;
                return;
            case 4 /* AnonymousFunctionCreationExpression */:
                this._nextFormatRule = null;
                break;
            case undefined:
                //tokens
                break;
            default:
                return;
        }
        switch (node.tokenType) {
            case 160 /* DocumentComment */:
                this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                break;
            case 116 /* OpenBrace */:
                if (parent.phraseType === 56 /* EncapsulatedExpression */) {
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                else {
                    this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                }
                this._incrementIndent();
                break;
            case 119 /* CloseBrace */:
                if (parent.phraseType !== 57 /* EncapsulatedVariable */ &&
                    parent.phraseType !== 56 /* EncapsulatedExpression */ &&
                    parent.phraseType !== 159 /* SubscriptExpression */) {
                    this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                }
                break;
            case 88 /* Semicolon */:
                this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                break;
            case 87 /* Colon */:
                if (this._shouldIndentAfterColon(spine[spine.length - 1])) {
                    this._incrementIndent();
                    this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                }
                break;
            case 103 /* Ampersand */:
                if (parent.phraseType !== 14 /* BitwiseExpression */) {
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                break;
            case 111 /* Plus */:
            case 143 /* Minus */:
                if (parent.phraseType === 173 /* UnaryOpExpression */) {
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                break;
            case 135 /* PlusPlus */:
                if (parent.phraseType === 133 /* PrefixIncrementExpression */) {
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                break;
            case 129 /* MinusMinus */:
                if (parent.phraseType === 132 /* PrefixDecrementExpression */) {
                    this._nextFormatRule = FormatVisitor.noSpaceBefore;
                }
                break;
            case 134 /* Ellipsis */:
            case 89 /* Exclamation */:
            case 94 /* AtSymbol */:
            case 155 /* ArrayCast */:
            case 148 /* BooleanCast */:
            case 153 /* FloatCast */:
            case 152 /* IntegerCast */:
            case 151 /* ObjectCast */:
            case 150 /* StringCast */:
            case 149 /* UnsetCast */:
            case 86 /* Tilde */:
            case 147 /* Backslash */:
            case 118 /* OpenParenthesis */:
            case 117 /* OpenBracket */:
                this._nextFormatRule = FormatVisitor.noSpaceBefore;
                break;
            case 128 /* CurlyOpen */:
            case 131 /* DollarCurlyOpen */:
                this._incrementIndent();
                this._nextFormatRule = FormatVisitor.noSpaceBefore;
                break;
            case 93 /* Comma */:
                if (parent.phraseType === 11 /* ArrayInitialiserList */) {
                    this._nextFormatRule = FormatVisitor.singleSpaceOrNewlineIndentBefore;
                }
                else if (this._isMultilineCommaDelimitedListStack.length > 0 &&
                    this._isMultilineCommaDelimitedListStack[this._isMultilineCommaDelimitedListStack.length - 1]) {
                    this._nextFormatRule = FormatVisitor.newlineIndentBefore;
                }
                else {
                    this._nextFormatRule = FormatVisitor.singleSpaceBefore;
                }
                break;
            case 115 /* Arrow */:
            case 133 /* ColonColon */:
                this._nextFormatRule = FormatVisitor.noSpaceOrNewlineIndentPlusOneBefore;
                break;
            case 156 /* OpenTag */:
                let tagText = this.doc.tokenText(node);
                if (tagText.length > 2) {
                    if (FormatVisitor.countNewlines(tagText) > 0) {
                        this._nextFormatRule = FormatVisitor.indentBefore;
                    }
                    else {
                        this._nextFormatRule = FormatVisitor.noSpaceBefore;
                    }
                    break;
                }
            //fall through
            case 157 /* OpenTagEcho */:
                this._nextFormatRule = FormatVisitor.singleSpaceOrNewlineIndentBefore;
                break;
            default:
                break;
        }
    }
    _incrementIndent() {
        this._indentText += this._indentUnit;
    }
    _decrementIndent() {
        this._indentText = this._indentText.slice(0, -this._indentUnit.length);
    }
    _hasNewlineWhitespaceChild(phrase) {
        for (let n = 0, l = phrase.children.length; n < l; ++n) {
            if (phrase.children[n].tokenType === 161 /* Whitespace */ &&
                FormatVisitor.countNewlines(this.doc.tokenText(phrase.children[n])) > 0) {
                return true;
            }
        }
        return false;
    }
    _isLastNamespaceUseDeclaration(parent, child) {
        let i = parent.children.indexOf(child);
        while (i < parent.children.length) {
            ++i;
            child = parent.children[i];
            if (child.phraseType) {
                return child.phraseType !== 123 /* NamespaceUseDeclaration */;
            }
        }
        return true;
    }
    _shouldIndentAfterColon(parent) {
        switch (parent.phraseType) {
            case 17 /* CaseStatement */:
            case 48 /* DefaultStatement */:
                return true;
            default:
                return false;
        }
    }
    _shouldOpenParenthesisHaveNoSpaceBefore(parent) {
        switch (parent.phraseType) {
            case 84 /* FunctionCallExpression */:
            case 111 /* MethodCallExpression */:
            case 149 /* ScopedCallExpression */:
            case 51 /* EchoIntrinsic */:
            case 55 /* EmptyIntrinsic */:
            case 68 /* EvalIntrinsic */:
            case 69 /* ExitIntrinsic */:
            case 106 /* IssetIntrinsic */:
            case 107 /* ListIntrinsic */:
            case 134 /* PrintIntrinsic */:
            case 174 /* UnsetIntrinsic */:
            case 9 /* ArrayCreationExpression */:
            case 87 /* FunctionDeclarationHeader */:
            case 114 /* MethodDeclarationHeader */:
            case 127 /* ObjectCreationExpression */:
                return true;
            default:
                return false;
        }
    }
    _hasColonChild(phrase) {
        for (let n = 0, l = phrase.children.length; n < l; ++n) {
            if (phrase.children[n].tokenType === 87 /* Colon */) {
                return true;
            }
        }
        return false;
    }
}
(function (FormatVisitor) {
    function singleSpaceBefore(previous, doc, indentText, indentUnit) {
        if (previous.tokenType !== 161 /* Whitespace */) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length), ' ');
        }
        let actualWs = doc.tokenText(previous);
        let expectedWs = ' ';
        if (actualWs === expectedWs) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);
    }
    FormatVisitor.singleSpaceBefore = singleSpaceBefore;
    function indentBefore(previous, doc, indentText, indentUnit) {
        if (previous.tokenType !== 161 /* Whitespace */) {
            return indentText ? lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length), indentText) : null;
        }
        if (!indentText) {
            return lsp.TextEdit.del(doc.tokenRange(previous));
        }
        let actualWs = doc.tokenText(previous);
        if (actualWs === indentText) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), indentText);
    }
    FormatVisitor.indentBefore = indentBefore;
    function newlineIndentBefore(previous, doc, indentText, indentUnit) {
        if (previous.tokenType !== 161 /* Whitespace */) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length), '\n' + indentText);
        }
        let actualWs = doc.tokenText(previous);
        let expectedWs = createWhitespace(Math.max(1, countNewlines(actualWs)), '\n') + indentText;
        if (actualWs === expectedWs) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);
    }
    FormatVisitor.newlineIndentBefore = newlineIndentBefore;
    function doubleNewlineIndentBefore(previous, doc, indentText, indentUnit) {
        if (previous.tokenType !== 161 /* Whitespace */) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length), '\n\n' + indentText);
        }
        let actualWs = doc.tokenText(previous);
        let expected = createWhitespace(Math.max(2, countNewlines(actualWs)), '\n') + indentText;
        if (actualWs === expected) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expected);
    }
    FormatVisitor.doubleNewlineIndentBefore = doubleNewlineIndentBefore;
    function noSpaceBefore(previous, doc, indentText, indentUnit) {
        if (previous.tokenType !== 161 /* Whitespace */) {
            return null;
        }
        return lsp.TextEdit.del(doc.tokenRange(previous));
    }
    FormatVisitor.noSpaceBefore = noSpaceBefore;
    function noSpaceOrNewlineIndentPlusOneBefore(previous, doc, indentText, indentUnit) {
        if (previous.tokenType !== 161 /* Whitespace */) {
            return null;
        }
        let actualWs = doc.tokenText(previous);
        let newlineCount = countNewlines(actualWs);
        if (!newlineCount) {
            return lsp.TextEdit.del(doc.tokenRange(previous));
        }
        let expectedWs = createWhitespace(newlineCount, '\n') + indentText + indentUnit;
        if (actualWs === expectedWs) {
            return null;
        }
        return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);
    }
    FormatVisitor.noSpaceOrNewlineIndentPlusOneBefore = noSpaceOrNewlineIndentPlusOneBefore;
    function singleSpaceOrNewlineIndentPlusOneBefore(previous, doc, indentText, indentUnit) {
        if (previous.tokenType !== 161 /* Whitespace */) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length), ' ');
        }
        let actualWs = doc.tokenText(previous);
        if (actualWs === ' ') {
            return null;
        }
        let newlineCount = countNewlines(actualWs);
        if (!newlineCount) {
            return lsp.TextEdit.replace(doc.tokenRange(previous), ' ');
        }
        let expectedWs = createWhitespace(newlineCount, '\n') + indentText + indentUnit;
        if (actualWs !== expectedWs) {
            return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);
        }
        return null;
    }
    FormatVisitor.singleSpaceOrNewlineIndentPlusOneBefore = singleSpaceOrNewlineIndentPlusOneBefore;
    function singleSpaceOrNewlineIndentBefore(previous, doc, indentText, indentUnit) {
        if (previous.tokenType !== 161 /* Whitespace */) {
            return lsp.TextEdit.insert(doc.positionAtOffset(previous.offset + previous.length), ' ');
        }
        let actualWs = doc.tokenText(previous);
        if (actualWs === ' ') {
            return null;
        }
        let newlineCount = countNewlines(actualWs);
        if (!newlineCount) {
            return lsp.TextEdit.replace(doc.tokenRange(previous), ' ');
        }
        let expectedWs = createWhitespace(newlineCount, '\n') + indentText;
        if (actualWs !== expectedWs) {
            return lsp.TextEdit.replace(doc.tokenRange(previous), expectedWs);
        }
        return null;
    }
    FormatVisitor.singleSpaceOrNewlineIndentBefore = singleSpaceOrNewlineIndentBefore;
    function createWhitespace(n, unit) {
        let text = '';
        while (n > 0) {
            text += unit;
            --n;
        }
        return text;
    }
    FormatVisitor.createWhitespace = createWhitespace;
    function countNewlines(text) {
        let c;
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
            }
            else if (c === '\n') {
                ++count;
            }
        }
        return count;
    }
    FormatVisitor.countNewlines = countNewlines;
})(FormatVisitor || (FormatVisitor = {}));
