/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { TreeVisitor, MultiVisitor } from './types';
import { Phrase, Token, PhraseType, TokenType } from 'php7parser';
import { SymbolKind, PhpSymbol, SymbolModifier } from './symbol';
import { SymbolStore, SymbolTable } from './symbolStore';
import { ParsedDocument, NodeTransform } from './parsedDocument';
import { NameResolver } from './nameResolver';
import { Predicate, BinarySearch, BinarySearchResult } from './types';
import { NameResolverVisitor } from './nameResolverVisitor';
import { ParseTreeHelper } from './parseTreeHelper';
import * as lsp from 'vscode-languageserver-types';
import { isInRange } from './util';
import { TypeString } from './typeString';
import { TypeAggregate } from './typeAggregate';
import * as util from './util';

interface TypeNodeTransform extends NodeTransform {
    type: string;
}

interface ReferenceNodeTransform extends NodeTransform {
    reference: Reference;
}

interface VariableNodeTransform extends NodeTransform {
    variable: Variable;
}

interface TextNodeTransform extends NodeTransform {
    text: string;
}

function symbolsToTypeReduceFn(prev: string, current: PhpSymbol) {
    return TypeString.merge(prev, PhpSymbol.type(current));
}

export class ReferenceReader extends MultiVisitor<Phrase | Token> {

    constructor(
        public nameResolverVisitor: NameResolverVisitor,
        public referenceVisitor: ReferenceVisitor
    ) {
        super([
            nameResolverVisitor,
            referenceVisitor
        ]);
    }

    static create(document: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, symbolTable: SymbolTable) {
        return new ReferenceReader(
            new NameResolverVisitor(document, nameResolver),
            new ReferenceVisitor(document, nameResolver, symbolStore, symbolTable)
        );
    }

}

export class ReferenceVisitor implements TreeVisitor<Phrase | Token> {

    private _transformStack: NodeTransform[];
    private _variableTable: VariableTable;
    private _scopeSymbolsPos = 0;
    private _contextStack: TypeAggregate[];
    private _scopeStack: PhpSymbol[];
    private _scopeSymbols: PhpSymbol[];

    constructor(
        public doc: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        public symbolTable: SymbolTable
    ) {
        this._transformStack = [];
        this._variableTable = new VariableTable();
        this._contextStack = [];
        this._scopeStack = [];
        this._scopeSymbols = symbolTable.scopeSymbols();
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine.length ? spine[spine.length - 1] : null;
        let parentTransform = this._transformStack.length ? this._transformStack[this._transformStack.length] : null;

        switch ((<Phrase>node).phraseType) {

            //case PhraseType.Error:
            //    return false;

            case PhraseType.FunctionDeclaration:
                this._functionDeclaration();
                break;

            case PhraseType.MethodDeclaration:
                this._methodDeclaration();
                break;

            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                {
                    let context = this._nextScopeSymbol();
                    this._scopeStack.push(context);
                    this._contextStack.push(new TypeAggregate(this.symbolStore, context));
                    this._variableTable.pushScope();
                    this._variableTable.setTypedVariable({ name: '$this', type: context.name });
                }
                break;

            case PhraseType.AnonymousFunctionCreationExpression:
                this._anonymousFunctionCreationExpression();
                break;

            case PhraseType.IfStatement:
            case PhraseType.SwitchStatement:
                this._variableTable.pushBranch();
                break;

            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
            case PhraseType.ElseIfClause:
            case PhraseType.ElseClause:
                this._variableTable.popBranch();
                this._variableTable.pushBranch();
                break;

            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.ByRefAssignmentExpression:
                this._transformStack.push(new SimpleAssignmentExpressionTransform((<Phrase>node).phraseType));
                break;

            case PhraseType.InstanceOfExpression:
                this._transformStack.push(new InstanceOfExpressionTransform());
                break;

            case PhraseType.ForeachStatement:
                this._transformStack.push(new ForeachStatementTransform());
                break;

            case PhraseType.ForeachCollection:
                this._transformStack.push(new ForeachCollectionTransform());
                break;

            case PhraseType.ForeachValue:
                this._transformStack.push(new ForeachValueTransform());
                break;

            case PhraseType.CatchClause:
                this._transformStack.push(new CatchClauseTransform());
                break;

            case PhraseType.CatchNameList:
                this._transformStack.push(new CatchNameListTransform());
                break;

            case PhraseType.QualifiedName:
                this._transformStack.push(
                    new QualifiedNameTransform(this._nameSymbolType(<Phrase>parent), this.doc.nodeRange(node), this.nameResolver)
                );
                break;

            case PhraseType.FullyQualifiedName:
                this._transformStack.push(
                    new FullyQualifiedNameTransform(this._nameSymbolType(<Phrase>parent), this.doc.nodeRange(node))
                );
                break;

            case PhraseType.RelativeQualifiedName:
                this._transformStack.push(
                    new RelativeQualifiedNameTransform(this._nameSymbolType(<Phrase>parent), this.doc.nodeRange(node), this.nameResolver)
                );
                break;

            case PhraseType.NamespaceName:
                this._transformStack.push(new NamespaceNameTransform());
                break;

            case PhraseType.SimpleVariable:
                this._transformStack.push(new SimpleVariableTransform(this.doc.nodeRange(node), this._variableTable));
                break;

            case PhraseType.ListIntrinsic:
                this._transformStack.push(new ListIntrinsicTransform());
                break;

            case PhraseType.ArrayInitialiserList:
                if (parentTransform) {
                    this._transformStack.push(new ArrayInititialiserListTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.ArrayElement:
                if (parentTransform) {
                    this._transformStack.push(new ArrayElementTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.ArrayValue:
                if (parentTransform) {
                    this._transformStack.push(new ArrayValueTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.SubscriptExpression:
                if (parentTransform) {
                    this._transformStack.push(new SubscriptExpressionTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.ScopedCallExpression:
                this._transformStack.push(
                    new MemberAccessExpressionTransform(PhraseType.ScopedCallExpression, SymbolKind.Method, this._referenceSymbols)
                );
                break;

            case PhraseType.ScopedPropertyAccessExpression:
                this._transformStack.push(
                    new MemberAccessExpressionTransform(PhraseType.ScopedPropertyAccessExpression, SymbolKind.Property, this._referenceSymbols)
                );
                break;

            case PhraseType.ClassConstantAccessExpression:
                this._transformStack.push(
                    new MemberAccessExpressionTransform(PhraseType.ClassConstantAccessExpression, SymbolKind.ClassConstant, this._referenceSymbols)
                );
                break;

            case PhraseType.ScopedMemberName:
                this._transformStack.push(new ScopedMemberNameTransform(this.doc.nodeRange(node)));
                break;

            case PhraseType.Identifier:
                if (parentTransform) {
                    this._transformStack.push(new IdentifierTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.PropertyAccessExpression:
                this._transformStack.push(
                    new MemberAccessExpressionTransform(PhraseType.PropertyAccessExpression, SymbolKind.Property, this._referenceSymbols)
                );
                break;

            case PhraseType.MethodCallExpression:
                this._transformStack.push(
                    new MemberAccessExpressionTransform(PhraseType.MethodCallExpression, SymbolKind.Method, this._referenceSymbols)
                );
                break;

            case PhraseType.MemberName:
                this._transformStack.push(new MemberNameTransform(this.doc.nodeRange(node)));
                break;

            case PhraseType.ObjectCreationExpression:
                if (parentTransform) {
                    this._transformStack.push(new ObjectCreationExpressionTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.ClassTypeDesignator:
            case PhraseType.InstanceofTypeDesignator:
                if (parentTransform) {
                    this._transformStack.push(new TypeDesignatorTransform((<Phrase>node).phraseType));
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.RelativeScope:
                if (parentTransform) {
                    let context = this._contextStack.length ? this._contextStack[this._contextStack.length - 1] : null;
                    let name = context ? context.type.name : '';
                    this._transformStack.push(new RelativeScopeTransform(name));
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.InstanceOfExpression:
                this._transformStack.push(new InstanceOfExpressionTransform());
                break;

            case PhraseType.TernaryExpression:
                if (parentTransform) {
                    this._transformStack.push(new TernaryExpressionTransform());
                } else {

                }
                break;

            case PhraseType.CoalesceExpression:
                if (parentTransform) {
                    this._transformStack.push(new CoalesceExpressionTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case undefined:
                //tokens
                if (parentTransform && (<Token>node).tokenType > TokenType.EndOfFile && (<Token>node).tokenType < TokenType.Equals) {
                    parentTransform.push(new TokenTransform(<Token>node, this.doc));
                    if (parentTransform.phraseType === PhraseType.CatchClause && (<Token>node).tokenType === TokenType.VariableName) {
                        this._variableTable.setTypedVariable(parentTransform.value);
                    }
                }
                break;

            default:
                this._transformStack.push(null);
                break;
        }

        return true;

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (!(<Phrase>node).phraseType) {
            return;
        }

        let transform = this._transformStack.pop();
        let parentTransform = this._transformStack.length ? this._transformStack[this._transformStack.length - 1] : null;
        let scope = this._scopeStack.length ? this._scopeStack[this._scopeStack.length - 1] : null;

        if (parentTransform && transform) {
            parentTransform.push(transform);
        }

        switch ((<Phrase>node).phraseType) {

            case PhraseType.FullyQualifiedName:
            case PhraseType.QualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.SimpleVariable:
            case PhraseType.ScopedCallExpression:
            case PhraseType.ClassConstantAccessExpression:
            case PhraseType.ScopedPropertyAccessExpression:
            case PhraseType.PropertyAccessExpression:
            case PhraseType.MethodCallExpression:
                if (scope) {
                    if (!scope.references) {
                        scope.references = [];
                    }
                    scope.references.push(transform.value);
                }
                break;

            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.ByRefAssignmentExpression:
                this._variableTable.setTypedVariables((<SimpleAssignmentExpressionTransform>transform).typedVariables);
                break;

            case PhraseType.InstanceOfExpression:
                this._variableTable.setTypedVariable((<InstanceOfExpressionTransform>transform).value);
                break;

            case PhraseType.ForeachValue:
                this._variableTable.setTypedVariables((<ForeachStatementTransform>parentTransform).typedVariables);
                break;

            case PhraseType.IfStatement:
            case PhraseType.SwitchStatement:
                this._variableTable.popBranch();
                this._variableTable.pruneBranches();
                break;

            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                this._contextStack.pop();
                this._scopeStack.pop();
                this._variableTable.popScope();
                break;

            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
                this._scopeStack.pop();
                this._variableTable.popScope();
                break;

            default:
                break;
        }

    }

    private _nameSymbolType(parent: Phrase) {
        if (!parent) {
            return SymbolKind.Class;
        }

        switch (parent.phraseType) {
            case PhraseType.ConstantAccessExpression:
                return SymbolKind.Constant;
            case PhraseType.FunctionCallExpression:
                return SymbolKind.Function;
            default:
                return SymbolKind.Class;
        }
    }

    private _nextScopeSymbol() {
        ++this._scopeSymbolsPos;
        return this._scopeSymbols.length < this._scopeSymbolsPos ? this._scopeSymbols[this._scopeSymbolsPos] : null;
    }

    private _methodDeclaration() {
        let symbol = this._nextScopeSymbol();
        this._scopeStack.push(symbol);
        this._variableTable.pushScope();
        let type = this._contextStack[this._contextStack.length - 1];
        let lcName = symbol.name.toLowerCase();
        let fn = (x: PhpSymbol) => {
            return x.kind === SymbolKind.Method && lcName === x.name.toLowerCase();
        };
        //lookup method on aggregate to inherit doc
        symbol = type.members(fn).shift();
        let children = symbol && symbol.children ? symbol.children : [];
        let param: PhpSymbol;
        for (let n = 0, l = children.length; n < l; ++n) {
            param = children[n];
            if (param.kind === SymbolKind.Parameter) {
                this._variableTable.setTypedVariable({ name: param.name, type: PhpSymbol.type(param) });
            }
        }
    }

    private _functionDeclaration() {
        let symbol = this._nextScopeSymbol();
        this._scopeStack.push(symbol);
        this._variableTable.pushScope();
        let children = symbol && symbol.children ? symbol.children : [];
        let param: PhpSymbol;
        for (let n = 0, l = children.length; n < l; ++n) {
            param = children[n];
            if (param.kind === SymbolKind.Parameter) {
                this._variableTable.setTypedVariable({ name: param.name, type: PhpSymbol.type(param) });
            }
        }
    }

    private _anonymousFunctionCreationExpression() {
        let symbol = this._nextScopeSymbol();
        this._scopeStack.push(symbol);
        let carry: string[] = [];
        let children = symbol && symbol.children ? symbol.children : [];
        let s: PhpSymbol;

        for (let n = 0, l = children.length; n < l; ++n) {
            s = children[n];
            if (s.kind === SymbolKind.Variable && (s.modifiers & SymbolModifier.Use) > 0) {
                carry.push(s.name);
            }
        }

        this._variableTable.pushScope(carry);

        for (let n = 0, l = children.length; n < l; ++n) {
            s = children[n];
            if (s.kind === SymbolKind.Parameter) {
                this._variableTable.setTypedVariable({ name: s.name, type: PhpSymbol.type(s) });
            }
        }

    }

    private _referenceSymbols: ReferenceSymbolDelegate = (ref) => {
        return Reference.findSymbols(ref, this.symbolStore, this.doc.uri);
    }

}

class TokenTransform implements TypeNodeTransform, TextNodeTransform {

    constructor(public token: Token, public doc: ParsedDocument) { }

    get tokenType() {
        return this.token.tokenType;
    }

    get text() {
        return this.doc.tokenText(this.token);
    }

    get type() {
        switch (this.token.tokenType) {
            case TokenType.FloatingLiteral:
                return 'float';
            case TokenType.StringLiteral:
            case TokenType.EncapsulatedAndWhitespace:
                return 'string';
            case TokenType.IntegerLiteral:
                return 'int';
            case TokenType.Name:
                {
                    let lcName = this.text.toLowerCase();
                    return lcName === 'true' || lcName === 'false' ? 'bool' : '';
                }
            default:
                return '';
        }
    }

    push(transform: NodeTransform) { }

}

class NamespaceNameTransform implements NodeTransform {

    phraseType = PhraseType.NamespaceName;
    text = '';

    constructor(public node: Phrase, public document: ParsedDocument) { }

    get range() {
        return this.document.nodeRange(this.node);
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name || transform.tokenType === TokenType.Backslash) {
            this.text += (<TokenTransform>transform).text;
        }
    }

}

class NamespaceUseDeclarationTransform implements NodeTransform {

    phraseType = PhraseType.NamespaceUseDeclaration;
    references: Reference[];
    private _kind = SymbolKind.Class;
    private _prefix = '';

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Const) {
            this._kind = SymbolKind.Constant;
        } else if (transform.tokenType === TokenType.Function) {
            this._kind = SymbolKind.Function;
        } else if (transform.phraseType === PhraseType.NamespaceName) {
            this._prefix = (<NamespaceNameTransform>transform).text;
        } else if (transform.phraseType === PhraseType.NamespaceUseGroupClauseList) {

        } else if (transform.phraseType === PhraseType.NamespaceUseClauseList) {

        }
    }

}

class NamespaceUseClauseTransform implements NodeTransform<Reference> {

    phraseType = PhraseType.NamespaceUseClause;
    value: Reference;

    push(transform: NodeTransform<any>) {

    }

}

class NamespaceUseGroupClauseTransform implements NodeTransform<Reference> {

    phraseType = PhraseType.NamespaceUseGroupClause;
    value: Reference;

    push(transform: NodeTransform<any>) {

    }

}

type ReferenceSymbolDelegate = (ref: Reference) => PhpSymbol[];

class CatchClauseTransform implements VariableNodeTransform {

    phraseType = PhraseType.CatchClause;
    typedVariable: TypedVariable;

    constructor() {
        this.typedVariable = {
            name: '',
            type: ''
        };
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.CatchNameList) {
            this.typedVariable.type = (<CatchNameListTransform>transform).type;
        } else if (transform.tokenType === TokenType.VariableName) {
            this.typedVariable.name = (<TokenTransform>transform).text;
        }
    }

}

class CatchNameListTransform implements TypeNodeTransform {

    phraseType = PhraseType.CatchNameList;
    type = '';

    push(transform: NodeTransform) {
        let ref = (<ReferenceNodeTransform>transform).reference;
        if (ref) {
            this.type = TypeString.merge(this.type, ref.name);
        }
    }

}

class ForeachStatementTransform implements NodeTransform {

    phraseType = PhraseType.ForeachStatement;
    typedVariables: TypedVariable[];
    private _type = '';

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.ForeachCollection) {
            this._type = TypeString.arrayDereference((<ForeachCollectionTransform>transform).type);
        } else if (transform.phraseType === PhraseType.ForeachValue) {
            let fn = transform.value as AssignVariableTypeMany;
            if (fn) {
                this.typedVariables = fn(this._type);
            }
        }
    }

}

interface Variable {
    name: string;
    arrayDereferenced: number;
    type: string;
}

namespace Variable {
    export function resolveBaseVariable(variable: Variable, type: string) {
        let deref = variable.arrayDereferenced;
        if (deref > 0) {
            while (deref-- > 0) {
                type = TypeString.arrayReference(type);
            }
        } else if (deref < 0) {
            while (deref++ < 0) {
                type = TypeString.arrayDereference(type);
            }
        }
        return <Variable>{
            name: variable.name,
            arrayDereferenced: 0,
            type: type
        };
    }
}

class ForeachValueTransform implements NodeTransform {

    phraseType = PhraseType.ForeachValue;
    variables: Variable[];

    constructor() {
        this.variables = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.SimpleVariable) {
            let ref = (<SimpleVariableTransform>transform).reference;
            this.variables = [{ name: ref.name, arrayDereferenced: 0, type:ref.type }];
        } else if (transform.phraseType === PhraseType.ListIntrinsic) {
            this.variables = (<ListIntrinsicTransform>transform).variables;
        }
    }

}

class ForeachCollectionTransform implements TypeNodeTransform {

    phraseType = PhraseType.ForeachCollection;
    type = '';

    push(transform: NodeTransform) {
        this.type = (<TypeNodeTransform>transform).type || '';
    }
}

class SimpleAssignmentExpressionTransform implements TypeNodeTransform {

    variables: Variable[];
    type = '';
    private _pushCount = 0;

    constructor(public phraseType: PhraseType) {
        this.variables = [];
    }

    push(transform: NodeTransform) {
        ++this._pushCount;

        //ws and = should be excluded
        if (this._pushCount === 1) {
            this._lhs(transform);
        } else if (this._pushCount === 2) {
            this.type = (<TypeNodeTransform>transform).type || '';
        }

    }

    private _lhs(lhs: NodeTransform) {
        switch (lhs.phraseType) {
            case PhraseType.SimpleVariable:
                {
                    let ref = (<SimpleVariableTransform>lhs).reference;
                    if (ref) {
                        this.variables.push({ name: ref.name, arrayDereferenced: 0, type: ref.type });
                    }
                    break;
                }
            case PhraseType.SubscriptExpression:
                {
                    let variable = (<SubscriptExpressionTransform>lhs).variable;
                    if (variable) {
                        this.variables.push(variable);
                    }
                    break;
                }
            case PhraseType.ListIntrinsic:
                    this.variables = (<ListIntrinsicTransform>lhs).variables;
                    break;
            default:
                break;
        }
    }

}

class ListIntrinsicTransform implements NodeTransform {

    phraseType = PhraseType.ListIntrinsic;
    variables: Variable[];

    constructor() {
        this.variables = [];
    }

    push(transform: NodeTransform) {
        //only ArrayInitialiserList should get pushed
        this.variables = (<ArrayInititialiserListTransform>transform).variables;
        for (let n = 0; n < this.variables.length; ++n) {
            this.variables[n].arrayDereferenced--;
        }
    }

}

class ArrayInititialiserListTransform implements TypeNodeTransform {

    phraseType = PhraseType.ArrayInitialiserList;
    variables: Variable[];
    private _types: string[];

    constructor() {
        this.variables = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.ArrayElement) {
            Array.prototype.push.apply(this.variables, (<ArrayElementTransform>transform).variables);
            this._types.push((<ArrayElementTransform>transform).type);
        }
    }

    get type() {
        let merged: string;
        let types: string[];
        if (this._types.length < 4) {
            types = this._types;
        } else {
            types = [this._types[0], this._types[Math.floor(this._types.length / 2)], this._types[this._types.length - 1]];
        }
        merged = TypeString.mergeMany(types);
        return TypeString.count(merged) < 3 && merged.indexOf('mixed') < 0 ? merged : 'mixed';
    }

}

class ArrayElementTransform implements TypeNodeTransform {

    phraseType = PhraseType.ArrayElement;
    variables: Variable[];
    type = '';

    constructor() {
        this.variables = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.ArrayValue) {
            this.variables = (<ArrayValueTransform>transform).variables;
            this.type = (<ArrayValueTransform>transform).type;
        }
    }

}

class ArrayValueTransform implements TypeNodeTransform {

    phraseType = PhraseType.ArrayValue;
    variables: Variable[];
    type = '';

    constructor() {
        this.variables = [];
    }

    push(transform: NodeTransform) {
        switch (transform.phraseType) {
            case PhraseType.SimpleVariable:
                {
                    let ref = (<SimpleVariableTransform>transform).reference;
                    this.variables = [{ name: ref.name, arrayDereferenced: 0, type: ref.type || '' }];
                    this.type = ref.type;
                }
                break;

            case PhraseType.SubscriptExpression:
                {
                    let v = (<SubscriptExpressionTransform>transform).variable
                    if (v) {
                        this.variables = [v];
                    }
                    this.type = (<SubscriptExpressionTransform>transform).type;
                }
                break;

            case PhraseType.ListIntrinsic:
                this.variables = (<ListIntrinsicTransform>transform).variables;
                break;

            default:
                if (transform.tokenType !== TokenType.Ampersand) {
                    this.type = (<TypeNodeTransform>transform).type;
                }
                break;
        }
    }

}

class CoalesceExpressionTransform implements TypeNodeTransform {

    phraseType = PhraseType.CoalesceExpression;
    type = '';

    push(transform: NodeTransform) {
        this.type = TypeString.merge(this.type, (<TypeNodeTransform>transform).type);
    }

}

class TernaryExpressionTransform implements TypeNodeTransform {

    phraseType = PhraseType.TernaryExpression;
    private _transforms: NodeTransform[];

    constructor() {
        this._transforms = [];
    }

    push(transform: NodeTransform) {
        this._transforms.push(transform);
    }

    get type() {
        return this._transforms.slice(-2).reduce<string>((prev, current) => {
            return TypeString.merge(prev, (<TypeNodeTransform>current).type);
        }, '');
    }

}

class SubscriptExpressionTransform implements TypeNodeTransform, VariableNodeTransform {

    phraseType = PhraseType.SubscriptExpression;
    variable: Variable;
    type = '';
    private _pushCount = 0;

    push(transform: NodeTransform) {

        if (this._pushCount > 0) {
            return;
        }

        ++this._pushCount;

        switch (transform.phraseType) {
            case PhraseType.SimpleVariable:
                {
                    let ref = (<SimpleVariableTransform>transform).reference;
                    if (ref) {
                        this.type = TypeString.arrayDereference(ref.type);
                        this.variable = { name: ref.name, arrayDereferenced: 1, type: this.type };
                    }
                }
                break;

            case PhraseType.SubscriptExpression:
                {
                    let v = (<SubscriptExpressionTransform>transform).variable;
                    this.type = TypeString.arrayDereference((<SubscriptExpressionTransform>transform).type);
                    if (v) {
                        v.arrayDereferenced++;
                        this.variable = v;
                        this.variable.type = this.type;
                    }
                }
                break;

            case PhraseType.FunctionCallExpression:
            case PhraseType.MethodCallExpression:
            case PhraseType.PropertyAccessExpression:
            case PhraseType.ScopedCallExpression:
            case PhraseType.ScopedPropertyAccessExpression:
            case PhraseType.ArrayCreationExpression:
                this.type = TypeString.arrayDereference((<TypeNodeTransform>transform).type);
                break;

            default:
                break;
        }
    }

}

class InstanceOfExpressionTransform implements TypeNodeTransform, VariableNodeTransform {

    phraseType = PhraseType.InstanceOfExpression;
    type = 'bool';
    private _pushCount = 0;
    private _varName = '';
    private _varType = '';

    push(transform: NodeTransform) {

        ++this._pushCount;
        if(this._pushCount === 1) {
            if(transform.phraseType === PhraseType.SimpleVariable) {
                let ref = (<SimpleVariableTransform>transform).reference;
                if (ref) {
                    this._varName = ref.name;
                }
            }
        } else if(transform.phraseType === PhraseType.InstanceOfExpression){
            this._varType = (<TypeDesignatorTransform>transform).type;
        }

        switch (transform.phraseType) {
            case PhraseType.InstanceofTypeDesignator:
                this.variable.type = (<TypeDesignatorTransform>transform).type;
                break;

            case PhraseType.SimpleVariable:
                {
                    let ref = (<SimpleVariableTransform>transform).reference;
                    if (ref) {
                        this.variable.name = ref.name;
                    }
                }
                break;

            default:
                break;
        }

    }

    get variable() {
        return this._varName && this._varType ? { name: this._varName, arrayDereferenced:0, type: this._varType } : null;
    }

}

class FunctionCallExpressionTransform implements TypeNodeTransform {

    phraseType = PhraseType.FunctionCallExpression;
    type = '';

    constructor(public referenceSymbolDelegate: ReferenceSymbolDelegate) { }

    push(transform: NodeTransform) {
        switch (transform.phraseType) {
            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.QualifiedName:
                this.type = this.referenceSymbolDelegate((<ReferenceNodeTransform>transform).reference).reduce(symbolsToTypeReduceFn, '');
                break;
            default:
                break;
        }
    }

}

class RelativeScopeTransform implements TypeNodeTransform {

    phraseType = PhraseType.RelativeScope;

    constructor(public type: string) { }
    push(transform: NodeTransform) { }
}

class TypeDesignatorTransform implements TypeNodeTransform {

    type = '';

    constructor(public phraseType: PhraseType) { }

    push(transform: NodeTransform) {
        switch (transform.phraseType) {
            case PhraseType.RelativeScope:
            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.QualifiedName:
                this.type = (<TypeNodeTransform>transform).type;
                break;

            default:
                break;
        }
    }

}

class AnonymousClassDeclarationTransform implements TypeNodeTransform {
    phraseType = PhraseType.AnonymousClassDeclaration;
    constructor(public type: string) { }
    push(transform: NodeTransform) { }

}

class ObjectCreationExpressionTransform implements TypeNodeTransform {

    phraseType = PhraseType.ObjectCreationExpression;
    type = '';

    push(transform: NodeTransform) {
        if (
            transform.phraseType === PhraseType.ClassTypeDesignator ||
            transform.phraseType === PhraseType.AnonymousClassDeclaration
        ) {
            this.type = (<TypeNodeTransform>transform).type;
        }
    }

}

class SimpleVariableTransform implements TypeNodeTransform, ReferenceNodeTransform {

    phraseType = PhraseType.SimpleVariable;
    reference: Reference;
    private _varTable: VariableTable;

    constructor(range: lsp.Range, varTable: VariableTable) {
        this._varTable = varTable;
        this.reference = Reference.create(SymbolKind.Variable, '', range);
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.VariableName) {
            this.reference.name = (<TokenTransform>transform).text;
            this.reference.type = this._varTable.getType(this.reference.name);
        }
    }

    get type() {
        return this.reference.type;
    }

}

class FullyQualifiedNameTransform implements TypeNodeTransform, ReferenceNodeTransform {

    phraseType = PhraseType.FullyQualifiedName;
    reference: Reference;

    constructor(symbolKind: SymbolKind, range: lsp.Range) {
        this.reference = Reference.create(symbolKind, '', range);
    }

    push(transform: NodeTransform) {

        if (transform.phraseType === PhraseType.NamespaceName) {
            this.reference.name = (<NamespaceNameTransform>transform).text;
        }

    }

    get type() {
        return this.reference.name;
    }

}

class QualifiedNameTransform implements TypeNodeTransform, ReferenceNodeTransform {

    phraseType = PhraseType.QualifiedName;
    reference: Reference;
    private _nameResolver: NameResolver;

    constructor(symbolKind: SymbolKind, range: lsp.Range, nameResolver: NameResolver) {
        this.reference = Reference.create(symbolKind, '', range);
        this._nameResolver = nameResolver;
    }

    push(transform: NodeTransform) {

        if (transform.phraseType === PhraseType.NamespaceName) {
            let name = (<NamespaceNameTransform>transform).text;
            this.reference.name = this._nameResolver.resolveNotFullyQualified(name, this.reference.kind);
            if (
                (this.reference.kind === SymbolKind.Function || this.reference.kind === SymbolKind.Constant) &&
                name !== this.reference.name
            ) {
                this.reference.altName = name;
            }
        }

    }

    get type() {
        return this.reference.name;
    }

}

class RelativeQualifiedNameTransform implements TypeNodeTransform, ReferenceNodeTransform {

    phraseType = PhraseType.RelativeQualifiedName;
    reference: Reference;
    private _nameResolver: NameResolver;

    constructor(symbolKind: SymbolKind, range: lsp.Range, nameResolver: NameResolver) {
        this.reference = Reference.create(symbolKind, '', range);
        this._nameResolver = nameResolver;
    }

    push(transform: NodeTransform) {

        if (transform.phraseType === PhraseType.NamespaceName) {
            this.reference.name = this._nameResolver.resolveRelative((<NamespaceNameTransform>transform).text);
        }

    }

    get type() {
        return this.reference.name;
    }

}

class MemberNameTransform implements ReferenceNodeTransform {

    phraseType = PhraseType.MemberName;
    reference: Reference;

    constructor(range: lsp.Range) {
        this.reference = Reference.create(SymbolKind.None, '', range);
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name) {
            this.reference.name = (<TokenTransform>transform).text;
        }
    }

}

class ScopedMemberNameTransform implements ReferenceNodeTransform {

    phraseType = PhraseType.ScopedMemberName;
    reference: Reference;

    constructor(range: lsp.Range) {
        this.reference = Reference.create(SymbolKind.None, '', range);
    }

    push(transform: NodeTransform) {
        if (
            transform.tokenType === TokenType.VariableName ||
            transform.phraseType === PhraseType.Identifier
        ) {
            this.reference.name = (<TextNodeTransform>transform).text;
        }
    }

}

class IdentifierTransform implements TextNodeTransform {
    phraseType = PhraseType.Identifier;
    text = '';
    push(transform: NodeTransform) {
        this.text = (<TokenTransform>transform).text;
    }
}

class MemberAccessExpressionTransform implements TypeNodeTransform, ReferenceNodeTransform {

    reference: Reference;

    constructor(
        public phraseType: PhraseType,
        public symbolKind: SymbolKind,
        public referenceSymbolDelegate: ReferenceSymbolDelegate
    ) { }

    push(transform: NodeTransform) {

        switch (transform.phraseType) {
            case PhraseType.ScopedMemberName:
            case PhraseType.MemberName:
                this.reference = (<ReferenceNodeTransform>transform).reference;
                this.reference.kind = this.symbolKind;
                break;

            case PhraseType.ScopedCallExpression:
            case PhraseType.MethodCallExpression:
            case PhraseType.PropertyAccessExpression:
            case PhraseType.ScopedPropertyAccessExpression:
            case PhraseType.FunctionCallExpression:
            case PhraseType.SubscriptExpression:
            case PhraseType.SimpleVariable:
            case PhraseType.FullyQualifiedName:
            case PhraseType.QualifiedName:
            case PhraseType.RelativeQualifiedName:
                this.reference.scope = (<TypeNodeTransform>transform).type;
                break;

            default:
                break;
        }

    }

    get type() {
        return this.referenceSymbolDelegate(this.reference).reduce(symbolsToTypeReduceFn, '');
    }

}



export interface Reference {
    kind: SymbolKind;
    name: string;
    range: lsp.Range;
    type?: string;
    altName?: string;
    scope?: string;
}

export namespace Reference {
    export function create(kind: SymbolKind, name: string, range: lsp.Range) {
        return {
            kind: kind,
            name: name,
            range: range
        };
    }

    export function toTypeString(ref: Reference, symbolStore: SymbolStore, uri: string) {

        if (!ref) {
            return '';
        }

        switch (ref.kind) {
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Trait:
                return ref.name;

            case SymbolKind.Function:
            case SymbolKind.Method:
            case SymbolKind.Property:
                return findSymbols(ref, symbolStore, uri).reduce<string>((carry, val) => {
                    return TypeString.merge(carry, PhpSymbol.type(val));
                }, '');

            case SymbolKind.Variable:
                return ref.type || '';

            default:
                return '';


        }
    }

    export function findSymbols(ref: Reference, symbolStore: SymbolStore, uri: string) {

        if (!ref) {
            return [];
        }

        let symbols: PhpSymbol[];
        let fn: Predicate<PhpSymbol>;
        let lcName: string;
        let table: SymbolTable;

        switch (ref.kind) {
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Trait:
                fn = (x) => {
                    return (x.kind & (SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait)) > 0;
                };
                symbols = symbolStore.find(ref.name, fn);
                break;

            case SymbolKind.Function:
            case SymbolKind.Constant:
                fn = (x) => {
                    return x.kind === ref.kind;
                };
                symbols = symbolStore.find(ref.name, fn);
                if (symbols.length < 1 && ref.altName) {
                    symbols = symbolStore.find(ref.altName, fn);
                }
                break;

            case SymbolKind.Method:
                lcName = ref.name.toLowerCase();
                fn = (x) => {
                    return x.kind === SymbolKind.Method && x.name.toLowerCase() === lcName;
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.Property:
                fn = (x) => {
                    return x.kind === SymbolKind.Property && x.name.slice(1) === ref.name;
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.ClassConstant:
                fn = (x) => {
                    return x.kind === SymbolKind.ClassConstant && x.name === ref.name;
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.Variable:
                table = symbolStore.getSymbolTable(uri);
                if (table) {
                    //find the var scope
                    fn = (x) => {
                        return ((x.kind === SymbolKind.Function && (x.modifiers & SymbolModifier.Anonymous) > 0) ||
                            x.kind === SymbolKind.Method) &&
                            x.location && util.isInRange(ref.range.start, x.location.range.start, x.location.range.end) === 0;
                    };
                    let scope = table.find(fn);
                    if (!scope) {
                        scope = table.root;
                    }
                    fn = (x) => {
                        return (x.kind & (SymbolKind.Parameter | SymbolKind.Variable)) > 0 &&
                            x.name === ref.name;
                    }
                    let s = scope.children ? scope.children.find(fn) : null;
                    if (s) {
                        symbols = [s];
                    }
                }
                break;

            default:
                break;

        }

        return symbols || [];

    }

    function findMembers(symbolStore: SymbolStore, scope: string, predicate: Predicate<PhpSymbol>) {

        let fqnArray = TypeString.atomicClassArray(scope);
        let type: TypeAggregate;
        let members = new Set<PhpSymbol>();
        for (let n = 0; n < fqnArray.length; ++n) {
            type = TypeAggregate.create(symbolStore, fqnArray[n]);
            if (type) {
                Set.prototype.add.apply(members, type.members(predicate));
            }
        }
        return Array.from(members);
    }

}

export class DocumentReferences {

    private _references: Reference[];
    private _uri: string;
    private _search: BinarySearch<Reference>;

    constructor(uri: string, references: Reference[]) {
        this._uri = uri;
        this._references = references;
        this._search = new BinarySearch(this._references);
    }

    filter(predicate: Predicate<Reference>) {
        let matches: Reference[] = [];
        let ref: Reference;
        for (let n = 0, l = this._references.length; n < l; ++n) {
            ref = this._references[n];
            if (predicate(ref)) {
                matches.push(ref);
            }
        }
        return matches;
    }

    referenceAtPosition(position: lsp.Position) {

        let fn = (x: Reference) => {
            return isInRange(position, x.range.start, x.range.end);
        }

        return this._search.find(fn);

    }

}

export class VariableTable {

    private _typeVariableSetStack: TypedVariableSet[];

    constructor() {

        this._typeVariableSetStack = [{
            kind: TypedVariableSetKind.Scope,
            variables: {},
            branches: []
        }];
    }

    setTypedVariable(typedVar: TypedVariable) {
        if (!typedVar) {
            return;
        }
        this._top().variables[typedVar.name] = typedVar;
    }

    setTypedVariables(typedVars: TypedVariable[]) {
        if (!typedVars) {
            return;
        }
        for (let n = 0; n < typedVars.length; ++n) {
            this.setTypedVariable(typedVars[n]);
        }
    }

    pushScope(carry?: string[]) {

        let scope = <TypedVariableSet>{
            kind: TypedVariableSetKind.Scope,
            variables: {},
            branches: []
        }

        if (carry) {
            let type: string;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n]);
                if (type) {
                    scope.variables[carry[n]] = { name: carry[n], type: type };
                }
            }
        }

        this._typeVariableSetStack.push(scope);

    }

    popScope() {
        this._typeVariableSetStack.pop();
    }

    pushBranch() {
        let b = <TypedVariableSet>{
            kind: TypedVariableSetKind.Branch,
            variables: {},
            branches: []
        };
        this._top().branches.push(b);
        this._typeVariableSetStack.push(b);
    }

    popBranch() {
        this._typeVariableSetStack.pop();
    }

    /**
     * consolidates variables. 
     * each variable can be any of types discovered in branches after this.
     */
    pruneBranches() {

        let node = this._top();
        let branches = node.branches;
        node.branches = [];
        for (let n = 0, l = branches.length; n < l; ++n) {
            this._mergeSets(node, branches[n]);
        }

    }

    getType(varName: string) {

        let typeSet: TypedVariableSet;

        for (let n = this._typeVariableSetStack.length - 1; n >= 0; --n) {
            typeSet = this._typeVariableSetStack[n];
            if (typeSet.variables[varName]) {
                return typeSet.variables[varName].type;
            }

            if (typeSet.kind === TypedVariableSetKind.Scope) {
                break;
            }
        }

        return '';

    }

    private _mergeSets(a: TypedVariableSet, b: TypedVariableSet) {

        let keys = Object.keys(b.variables);
        let typedVar: TypedVariable;
        for (let n = 0, l = keys.length; n < l; ++n) {
            typedVar = b.variables[keys[n]];
            if (a.variables[typedVar.name]) {
                a.variables[typedVar.name].type = TypeString.merge(a.variables[typedVar.name].type, typedVar.type);
            } else {
                a.variables[typedVar.name] = typedVar;
            }
        }

    }

    private _top() {
        return this._typeVariableSetStack[this._typeVariableSetStack.length - 1];
    }

}

export interface TypedVariable {
    name: string;
    type: string;
}

const enum TypedVariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface TypedVariableSet {
    kind: TypedVariableSetKind;
    variables: { [index: string]: TypedVariable };
    branches: TypedVariableSet[];
}