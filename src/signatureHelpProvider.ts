/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { SymbolKind, PhpSymbol, SymbolModifier } from './symbol';
import { SymbolStore, MemberQuery } from './symbolStore';
import { ExpressionTypeResolver } from './typeResolver';
import { Context } from './context';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import {
    Phrase, PhraseType, Token, ArgumentExpressionList,
    FunctionCallExpression, ScopedCallExpression, ObjectCreationExpression,
    MethodCallExpression, MemberName, TokenType
} from 'php7parser';
import * as util from './util';


export class SignatureHelpProvider {

    constructor(public symbolStore: SymbolStore, public docStore: ParsedDocumentStore) { }

    provideSignatureHelp(uri: string, position: lsp.Position) {

        let doc = this.docStore.find(uri);
        if (!doc) {
            return null;
        }

        let context = new Context(this.symbolStore, doc, position);
        let traverser = context.createTraverser();
        let callableExpr = traverser.ancestor(this._isCallablePhrase);

        if (!callableExpr || ParsedDocument.isToken(context.token, [TokenType.CloseParenthesis])) {
            return null;
        }

        let symbol = this._getSymbol(<Phrase>callableExpr, context);
        let argNumber = this._getArgumentNumber(<ArgumentExpressionList>(<Phrase>callableExpr).children.find((x) => {
            return ParsedDocument.isPhrase(x, [PhraseType.ArgumentExpressionList]);
        }), context);

        return symbol ? this._createSignatureHelp(symbol, argNumber) : null;

    }

    private _createSignatureHelp(fn: PhpSymbol, argNumber: number) {

        if(!fn.children) {
            return null;
        }

        let params = fn.children.filter((x) => {
            return x.kind === SymbolKind.Parameter;
        });

        if (!params.length || argNumber > params.length - 1) {
            return null;
        }

        let nOptionalParams = params.reduce<number>((carry, value) => {
            return value.value ? carry + 1 : carry;
        }, 0);

        let nRequiredParams = params.length - nOptionalParams;
        let signatures: lsp.SignatureInformation[] = [];

        if (nRequiredParams > 0) {
            signatures.push(this._signatureInfo(fn, params.slice(0, nRequiredParams)));
        }

        for (let n = 1; n <= nOptionalParams; ++n) {
            signatures.push(this._signatureInfo(fn, params.slice(0, nRequiredParams + n)));
        }

        let activeSig = signatures.findIndex((v) => {
            return v.parameters.length > argNumber;
        });

        return <lsp.SignatureHelp>{
            activeParameter: argNumber,
            activeSignature: activeSig,
            signatures: signatures
        };
    }

    private _signatureInfo(fn: PhpSymbol, params: PhpSymbol[]) {

        let paramInfoArray = this._parameterInfoArray(params);
        let label = fn.name + '(';
        label += paramInfoArray.map((v) => {
            return v.label;
        }).join(', ');
        label += ')';

        if (fn.type && !fn.type.isEmpty()) {
            label += ': ' + fn.type.toString();
        }

        return <lsp.SignatureInformation>{
            label: label,
            documentation: fn.description,
            parameters: paramInfoArray
        }

    }

    private _parameterInfoArray(params: PhpSymbol[]) {

        let infos: lsp.ParameterInformation[] = [];
        for (let n = 0, l = params.length; n < l; ++n) {
            infos.push(this._parameterInfo(params[n]));
        }

        return infos;
    }

    private _parameterInfo(s: PhpSymbol) {

        let labelParts: string[] = [];

        if (s.type && !s.type.isEmpty()) {
            labelParts.push(s.type.toString());
        }

        labelParts.push(s.name);

        if (s.value) {
            labelParts.push('= ' + s.value);
        }

        return <lsp.ParameterInformation>{
            label: labelParts.join(' '),
            documentation: s.description
        };
    }

    private _getSymbol(callableExpr: Phrase, context: Context) {
        switch (callableExpr.phraseType) {
            case PhraseType.FunctionCallExpression:
                return this._functionCallExpressionSymbol(<FunctionCallExpression>callableExpr, context);
            case PhraseType.MethodCallExpression:
                return this._methodCallExpressionSymbol(<MethodCallExpression>callableExpr, context);
            case PhraseType.ScopedCallExpression:
                return this._scopedCallExpressionSymbol(<ScopedCallExpression>callableExpr, context);
            case PhraseType.ObjectCreationExpression:
                return this._objectCreationExpressionSymbol(<ObjectCreationExpression>callableExpr, context);
            default:
                throw new Error('Invalid Argument');
        }
    }

    private _functionCallExpressionSymbol(phrase: FunctionCallExpression, context: Context) {

        let fqn = context.resolveFqn(<Phrase>phrase.callableExpr, SymbolKind.Function);
        return this.symbolStore.find(fqn, (x) => {
            return x.kind === SymbolKind.Function;
        });

    }

    private _methodCallExpressionSymbol(phrase: MethodCallExpression, context: Context) {

        let typeNames = context.resolveExpressionType(<Phrase>phrase.variable).atomicClassArray();
        let memberName = ParsedDocument.isFixedMemberName(<MemberName>phrase.memberName) ?
            context.nodeText(phrase.memberName) : '';

        if (!typeNames.length || !memberName) {
            return null;
        }

        let queries: MemberQuery[] = [];
        let pred = (x: PhpSymbol) => {
            return x.kind === SymbolKind.Method &&
                !(x.modifiers & SymbolModifier.Static) &&
                x.name === memberName;
        }

        for (let n = 0, l = typeNames.length; n < l; ++n) {
            queries.push({
                typeName: typeNames[n],
                memberPredicate: pred
            });
        }

        return this.symbolStore.lookupMembersOnTypes(queries).shift();

    }

    private _scopedCallExpressionSymbol(phrase: ScopedCallExpression, context: Context) {
        let typeNames = context.resolveExpressionType(<Phrase>phrase.scope).atomicClassArray();
        let memberName = ParsedDocument.isFixedScopedMemberName(phrase.memberName) ?
            context.nodeText(phrase.memberName) : '';

        if (!typeNames.length || !memberName) {
            return null;
        }

        let queries: MemberQuery[] = [];
        let pred = (x: PhpSymbol) => {
            return x.kind === SymbolKind.Method &&
                (x.modifiers & SymbolModifier.Static) > 0 &&
                x.name === memberName;
        }

        for (let n = 0, l = typeNames.length; n < l; ++n) {
            queries.push({
                typeName: typeNames[n],
                memberPredicate: pred
            });
        }

        return this.symbolStore.lookupMembersOnTypes(queries).shift();

    }

    private _objectCreationExpressionSymbol(phrase: ObjectCreationExpression, context: Context) {

        let typeName = context.resolveExpressionType(phrase.type).atomicClassArray().shift();

        if (!typeName) {
            return null;
        }

        return this.symbolStore.lookupTypeMember({
            typeName: typeName,
            memberPredicate: (x) => {
                return x.kind === SymbolKind.Method && x.name === '__construct';
            }
        });
    }

    private _getArgumentNumber(argList: ArgumentExpressionList, context: Context) {
        if (!ParsedDocument.isPhrase(argList, [PhraseType.ArgumentExpressionList])) {
            return 0;
        }

        let token = context.token;
        let delimeters = argList.children.filter((x) => {
            return (<Token>x).tokenType === TokenType.Comma && (<Token>x).offset <= token.offset;
        });

        return delimeters.length;

    }

    private _isCallablePhrase(node: Phrase | Token) {
        switch ((<Phrase>node).phraseType) {
            case PhraseType.FunctionCallExpression:
            case PhraseType.MethodCallExpression:
            case PhraseType.ScopedCallExpression:
            case PhraseType.ObjectCreationExpression:
                return true;
            default:
                return false;
        }
    }

}