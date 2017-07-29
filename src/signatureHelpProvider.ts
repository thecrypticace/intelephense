/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { SymbolKind, PhpSymbol, SymbolModifier } from './symbol';
import { SymbolStore } from './symbolStore';
import { Context } from './context';
import { TypeString } from './typeString';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Phrase, PhraseType, Token, TokenType } from 'php7parser';
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
        let callableExpr = traverser.ancestor(this._isCallablePhrase) as Phrase;

        if (!callableExpr || ParsedDocument.isToken(context.token, [TokenType.CloseParenthesis])) {
            return null;
        }

        let symbol = this._getSymbol(callableExpr, context);
        let argNumber = this._getArgumentNumber(ParsedDocument.firstPhraseOfType(PhraseType.ArgumentExpressionList, callableExpr.children), context);

        return symbol ? this._createSignatureHelp(symbol, argNumber) : null;

    }

    private _createSignatureHelp(fn: PhpSymbol, argNumber: number) {

        if (!fn.children) {
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

        let returnType = PhpSymbol.type(fn);
        if (returnType) {
            label += ': ' + returnType;
        }

        let info = <lsp.SignatureInformation>{
            label: label,
            parameters: paramInfoArray
        }

        if (fn.doc && fn.doc.description) {
            info.documentation = fn.doc.description;
        }

        return info;

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
        let paramType = PhpSymbol.type(s);
        if (paramType) {
            labelParts.push(paramType);
        }

        labelParts.push(s.name);

        if (s.value) {
            labelParts.push('= ' + s.value);
        }

        let info = <lsp.ParameterInformation>{
            label: labelParts.join(' '),
        };

        if (s.doc && s.doc.description) {
            info.documentation = s.doc.description;
        }

        return info;
    }

    private _getSymbol(callableExpr: Phrase, context: Context) {
        switch (callableExpr.phraseType) {
            case PhraseType.FunctionCallExpression:
                return this._functionCallExpressionSymbol(callableExpr, context);
            case PhraseType.MethodCallExpression:
                return this._methodCallExpressionSymbol(callableExpr, context);
            case PhraseType.ScopedCallExpression:
                return this._scopedCallExpressionSymbol(callableExpr, context);
            case PhraseType.ObjectCreationExpression:
                return this._objectCreationExpressionSymbol(callableExpr, context);
            default:
                throw new Error('Invalid Argument');
        }
    }

    private _functionCallExpressionSymbol(phrase: Phrase, context: Context) {

        let firstChild = phrase.children && phrase.children.length > 0 ? phrase.children[0] : null;
        if(!firstChild || !ParsedDocument.isPhrase(firstChild, [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName])) {
            return null;
        }

        let range = context.document.nodeRange(firstChild);
        if(!range) {
            return null;
        }

        let refContext = new Context(this.symbolStore, context.document, range.end);
        let ref = refContext.reference;

        if(!ref) {
            return null;
        }

        return this.symbolStore.findSymbolsByReference(ref).shift();

    }

    private _methodCallExpressionSymbol(phrase: Phrase, context: Context) {

        if(!phrase.children) {
            return null;
        }

        let memberName = ParsedDocument.firstPhraseOfType(PhraseType.MemberName, phrase.children);
        if(!memberName || !memberName.children || !memberName.children.length || (<Token>memberName.children[0]).tokenType !== TokenType.Name) {
            return null;
        }

        let range = context.document.nodeRange(memberName);
        if(!range) {
            return null;
        }

        let refContext = new Context(this.symbolStore, context.document, range.end);
        let ref = refContext.reference;

        if(!ref){
            return null;
        }

        return this.symbolStore.findSymbolsByReference(ref).shift();

    }

    private _scopedCallExpressionSymbol(phrase: Phrase, context: Context) {

        if(!phrase.children) {
            return null;
        }

        let memberName = ParsedDocument.firstPhraseOfType(PhraseType.ScopedMemberName, phrase.children);
        if(!memberName || !memberName.children || !memberName.children.length || (<Phrase>memberName.children[0]).phraseType !== PhraseType.Identifier) {
            return null;
        }

        let range = context.document.nodeRange(memberName);
        if(!range) {
            return null;
        }

        let refContext = new Context(this.symbolStore, context.document, range.end);
        let ref = refContext.reference;

        if(!ref){
            return null;
        }

        return this.symbolStore.findSymbolsByReference(ref).shift();

    }

    private _objectCreationExpressionSymbol(phrase: Phrase, context: Context) {

        if(!phrase.children) {
            return null;
        }

        let typeDesignator = ParsedDocument.firstPhraseOfType(PhraseType.ClassTypeDesignator, phrase.children);
        if(
            !typeDesignator || 
            !typeDesignator.children || 
            typeDesignator.children.length !== 1 || 
            ParsedDocument.isPhrase(typeDesignator.children[0], [PhraseType.RelativeScope, PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName])
        ){
            return null;
        }

        let range = context.document.nodeRange(typeDesignator);
        if(!range) {
            return null;
        }

        let refContext = new Context(this.symbolStore, context.document, range.end);
        let ref = refContext.reference;

        if(!ref){
            return null;
        }

        return this.symbolStore.findSymbolsByReference(ref).shift();

    }

    private _getArgumentNumber(argList: Phrase, context: Context) {
        if (!ParsedDocument.isPhrase(argList, [PhraseType.ArgumentExpressionList])) {
            return 0;
        }

        let token = context.token;
        let delimiters = argList.children.filter((x) => {
            return (<Token>x).tokenType === TokenType.Comma && (<Token>x).offset <= token.offset;
        });

        return delimiters.length;

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