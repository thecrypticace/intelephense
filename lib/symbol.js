/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const phpDoc_1 = require("./phpDoc");
const parse_1 = require("./parse");
const util = require("./util");
var PhpSymbol;
(function (PhpSymbol) {
    function acronym(s) {
        let text = s.name.slice(s.name.lastIndexOf('\\') + 1);
        if (!text) {
            return '';
        }
        let lcText = text.toLowerCase();
        let n = 0;
        let l = text.length;
        let c;
        let acronym = lcText[0] !== '_' && lcText[0] !== '$' ? lcText[0] : '';
        while (n < l) {
            c = text[n];
            if ((c === '$' || c === '_') && n + 1 < l && text[n + 1] !== '_') {
                ++n;
                acronym += lcText[n];
            }
            else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
                //uppercase
                acronym += lcText[n];
            }
            ++n;
        }
        return acronym;
    }
    PhpSymbol.acronym = acronym;
    /**
     * Get suffixes after $, namespace separator, underscore and on lowercase uppercase boundary
     */
    function suffixArray(s) {
        if (!s.name) {
            return [];
        }
        let text = s.name;
        let lcText = text.toLowerCase();
        let suffixes = [lcText];
        let n = 0;
        let c;
        let l = text.length;
        while (n < l) {
            c = text[n];
            if ((c === '$' || c === '\\' || c === '_') && n + 1 < l && text[n + 1] !== '_') {
                ++n;
                suffixes.push(lcText.slice(n));
            }
            else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
                //uppercase
                suffixes.push(lcText.slice(n));
            }
            ++n;
        }
        return suffixes;
    }
    PhpSymbol.suffixArray = suffixArray;
})(PhpSymbol = exports.PhpSymbol || (exports.PhpSymbol = {}));
class NameResolver {
    constructor(namespaceName, thisName, importedSymbols) {
        this.namespaceName = namespaceName;
        this.thisName = thisName;
        this.importedSymbols = importedSymbols;
    }
    resolveRelative(relativeName) {
        if (!relativeName) {
            return '';
        }
        return this.namespaceName ? this.namespaceName + '\\' + relativeName : relativeName;
    }
    resolveNotFullyQualified(notFqName, kind) {
        if (notFqName === 'self' || notFqName === 'static') {
            return this.thisName;
        }
        let pos = notFqName.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqName, kind) :
            this._resolveQualified(name, pos);
    }
    _matchImportedSymbol(text, kind) {
        let s;
        for (let n = 0, l = this.importedSymbols.length; n < l; ++n) {
            s = this.importedSymbols[n];
            if (s.kind === kind && text === s.name) {
                return s;
            }
        }
        return null;
    }
    _resolveQualified(name, pos) {
        let s = this._matchImportedSymbol(name.slice(0, pos), 1 /* Class */);
        return s ? s.associated[0].name + name.slice(pos) : this.resolveRelative(name);
    }
    _resolveUnqualified(name, kind) {
        let s = this._matchImportedSymbol(name, kind);
        return s ? s.associated[0].name : this.resolveRelative(name);
    }
}
exports.NameResolver = NameResolver;
class TypeString {
    constructor(text) {
        this._parts = text ? this._chunk(text) : [];
    }
    isEmpty() {
        return this._parts.length < 1;
    }
    atomicClassArray() {
        let parts = [];
        let part;
        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part[part.length - 1] !== ']' && TypeString._keywords.indexOf(part) < 0) {
                parts.push(part);
            }
        }
        return parts;
    }
    arrayDereference() {
        let parts = [];
        let part;
        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part.slice(-2) === '[]') {
                part = part.slice(0, -2);
                if (part.slice(-1) === ')') {
                    part = part.slice(1, -1);
                    Array.prototype.push.apply(parts, this._chunk(part));
                    parts = this._unique(parts);
                }
                else {
                    parts.push(part);
                }
            }
        }
        let typeString = new TypeString(null);
        typeString._parts = parts;
        return typeString;
    }
    array() {
        let text;
        if (this._parts.length > 1) {
            text = '(' + this.toString() + ')[]';
        }
        else {
            text = this._parts[0] + '[]';
        }
        return new TypeString(text);
    }
    merge(type) {
        let parts = util.isString(type) ? this._chunk(type) : type._parts;
        Array.prototype.push.apply(parts, this._parts);
        let newTypeString = new TypeString(null);
        newTypeString._parts = this._unique(parts);
        return newTypeString;
    }
    nameResolve(nameResolver) {
        let replacer = (match, offset, text) => {
            if (TypeString._keywords.indexOf(match[0]) >= 0) {
                return match[0];
            }
            else if (match[0] === '\\') {
                return match.slice(1);
            }
            else {
                return nameResolver.resolveNotFullyQualified(match, 1 /* Class */);
            }
        };
        return new TypeString(this._parts.join('|').replace(TypeString._classNamePattern, replacer));
    }
    toString() {
        return this._parts.join('|');
    }
    _unique(parts) {
        let map = {};
        let part;
        for (let n = 0; n < parts.length; ++n) {
            part = parts[n];
            map[part] = part;
        }
        return Object.keys(map);
    }
    _chunk(typeString) {
        let n = 0;
        let parentheses = 0;
        let parts = [];
        let part = '';
        let c;
        while (n < typeString.length) {
            c = typeString[n];
            switch (c) {
                case '|':
                    if (parentheses) {
                        part += c;
                    }
                    else if (part) {
                        parts.push(part);
                        part = '';
                    }
                    break;
                case '(':
                    ++parentheses;
                    part += c;
                    break;
                case ')':
                    --parentheses;
                    part += c;
                    break;
                default:
                    part += c;
                    break;
            }
            ++n;
        }
        if (part) {
            parts.push(part);
        }
        return parts;
    }
}
TypeString._classNamePattern = /([\\a-zA-Z_\x7f-\xff][\\a-zA-Z0-9_\x7f-\xff])*/g;
TypeString._keywords = [
    'string', 'integer', 'int', 'boolean', 'bool', 'float',
    'double', 'object', 'mixed', 'array', 'resource',
    'void', 'null', 'callback', 'false', 'true', 'self',
    'callable'
];
exports.TypeString = TypeString;
/*
export class SymbolTree {

    static parametersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Parameter;
    };

    static closureUseVariablesPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Variable &&
            (x.value.modifiers & SymbolModifier.Use) > 0;
    };

    static variablesPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Variable;
    };

    static instanceExternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            (x.value.modifiers & SymbolModifier.Public) > 0 &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static instanceInternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static instanceInheritedMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static staticInternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static staticExternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & SymbolModifier.Public) > 0 &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static staticInheritedMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static parameters(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.parametersPredicate);
    }

    static closureUseVariables(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.closureUseVariablesPredicate);
    }

    static variables(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.variablesPredicate);
    }

}
*/
class SymbolTable {
    constructor(uri, root) {
        this.uri = uri;
        this.root = root;
    }
    get symbols() {
        let traverser = new types_1.TreeTraverser([this.root]);
        let symbols = traverser.toArray();
        //remove root
        symbols.shift();
        return symbols;
    }
    get count() {
        let traverser = new types_1.TreeTraverser([this.root]);
        //subtract 1 for root
        return traverser.count() - 1;
    }
    filter(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.filter(predicate);
    }
    static create(parseTree, textDocument) {
        let symbolReader = new SymbolReader(textDocument, new NameResolver(null, null, []), [{ kind: 0 /* None */, name: '', children: [] }]);
        let traverser = new types_1.TreeTraverser([parseTree.root]);
        traverser.traverse(symbolReader);
        return new SymbolTable(textDocument.uri, symbolReader.spine[0]);
    }
}
exports.SymbolTable = SymbolTable;
class SymbolStore {
    constructor() {
        this._map = {};
        this._index = new SymbolIndex();
        this._symbolCount = 0;
    }
    getSymbolTable(uri) {
        return this._map[uri];
    }
    get tableCount() {
        return Object.keys(this._map).length;
    }
    get symbolCount() {
        return this._symbolCount;
    }
    add(symbolTable) {
        if (this.getSymbolTable(symbolTable.uri)) {
            throw new Error(`Duplicate key ${symbolTable.uri}`);
        }
        this._map[symbolTable.uri] = symbolTable;
        this._index.addMany(this._indexSymbols(symbolTable.root));
        this._symbolCount += symbolTable.count;
    }
    remove(uri) {
        let symbolTable = this.getSymbolTable(uri);
        if (!symbolTable) {
            return;
        }
        this._index.removeMany(this._indexSymbols(symbolTable.root));
        this._symbolCount -= symbolTable.count;
        delete this._map[uri];
    }
    /**
     * Matches any symbol by name or partial name (excluding parameters and variables)
     */
    match(text, kindMask) {
        let matched = this._index.match(text);
        if (!kindMask) {
            return matched;
        }
        let filtered = [];
        let s;
        for (let n = 0, l = matched.length; n < l; ++n) {
            s = matched[n];
            if ((s.kind & kindMask) > 0) {
                filtered.push(s);
            }
        }
        return filtered;
    }
    lookupTypeMembers(typeName, memberPredicate) {
        let type = this.match(typeName, 1 /* Class */ | 2 /* Interface */).shift();
        return this._lookupTypeMembers(type, memberPredicate);
    }
    lookupTypeMember(typeName, memberPredicate) {
        return this.lookupTypeMembers(typeName, memberPredicate).shift();
    }
    _lookupTypeMembers(type, predicate) {
        if (!type) {
            return [];
        }
        let members = type.children.filter(predicate);
        let associated = [];
        let associatedKindMask = 1 /* Class */ ? 1 /* Class */ | 4 /* Trait */ : 2 /* Interface */;
        let baseSymbol;
        if (type.associated) {
            for (let n = 0, l = type.associated.length; n < l; ++n) {
                baseSymbol = type.associated[n];
                if ((baseSymbol.kind & associatedKindMask) > 0 && baseSymbol.name) {
                    associated.push(baseSymbol);
                }
            }
        }
        //lookup in base class/traits
        let basePredicate = (x) => {
            return predicate(x) && !(x.modifiers & 4 /* Private */);
        };
        for (let n = 0, l = associated.length; n < l; ++n) {
            baseSymbol = associated[n];
            baseSymbol = this.match(baseSymbol.name, baseSymbol.kind).shift();
            if (baseSymbol) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(baseSymbol, basePredicate));
            }
        }
        return members;
    }
    _indexSymbols(root) {
        let notKindMask = 128 /* Parameter */ | 256 /* Variable */;
        let predicate = (x) => {
            return !(x.kind & notKindMask) && !!x.name;
        };
        let traverser = new types_1.TreeTraverser([root]);
        return traverser.filter(predicate);
    }
}
exports.SymbolStore = SymbolStore;
/*

interface ResolvedVariable {
    name: string;
    type: TypeString;
}

const enum VariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface VariableSet {
    kind: VariableSetKind;
    vars: { [index: string]: ResolvedVariable };
}


export class VariableTable {

    private _node: Tree<VariableSet>;
    private _thisTypeStack: TypeString[];

    constructor() {
        this._node = new Tree<VariableSet>({
            kind: VariableSetKind.Scope,
            vars: {}
        });
        this._thisTypeStack = [];
    }

    setType(varName: string, type: TypeString) {
        this._node.value.vars[varName] = { name: varName, type: type };
    }

    pushThisType(thisType: TypeString) {
        this._thisTypeStack.push(thisType);
    }

    popThisType() {
        this._thisTypeStack.pop();
    }

    pushScope(carry: string[] = null) {

        let resolvedVariables: ResolvedVariable[] = [];
        if (carry) {
            let type: TypeString;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n]);
                if (type) {
                    resolvedVariables.push({ name: carry[n], type: type });
                }
            }
        }

        this._pushNode(VariableSetKind.Scope);
        for (let n = 0; n < resolvedVariables.length; ++n) {
            this.setType(resolvedVariables[n].name, resolvedVariables[n].type);
        }
    }

    popScope() {
        this._node = this._node.parent;
    }

    pushBranch() {
        this._pushNode(VariableSetKind.Branch);
    }

    popBranch() {
        this._node = this._node.parent;
    }

    pushBranchGroup() {
        this._pushNode(VariableSetKind.BranchGroup);
    }

    popBranchGroup() {

        //can consolidate variables and prune tree as at this point
        //each variable may be any of types discovered in branches
        let b = this._node;
        this._node = b.parent;
        let consolidator = new TypeConsolidator(this._node.value.vars);
        b.traverse(consolidator);
        this._node.removeChild(b);

    }

    getType(varName: string) {

        let type: TypeString;
        let vars: { [index: string]: ResolvedVariable };
        let node = this._node;

        if (varName === '$this') {
            return util.top<TypeString>(this._thisTypeStack);
        }

        while (node) {

            if (node.value.vars.hasOwnProperty(varName)) {
                return node.value.vars[varName].type;
            } else if (node.value.kind !== VariableSetKind.Scope) {
                node = node.parent;
            } else {
                break;
            }

        }

        return null;

    }

    private _pushNode(kind: VariableSetKind) {
        let node = new Tree<VariableSet>({
            kind: kind,
            vars: {}
        });
        this._node = this._node.addChild(node);
    }

}

class TypeConsolidator implements TreeVisitor<VariableSet> {

    constructor(public variables: { [index: string]: ResolvedVariable }) {

    }

    preOrder(node: Tree<VariableSet>) {

        let keys = Object.keys(node.value.vars);
        let v: ResolvedVariable;
        let key: string;

        for (let n = 0; n < keys.length; ++n) {
            key = keys[n];
            v = node.value.vars[key];

            if (this.variables.hasOwnProperty(key)) {
                this.variables[key].type = this.variables[key].type.merge(v.type);
            } else {
                this.variables[key] = v;
            }
        }

        return true;

    }

}

*/
class SymbolReader {
    constructor(textDocument, nameResolver, spine) {
        this.textDocument = textDocument;
        this.nameResolver = nameResolver;
        this.spine = spine;
        SymbolReader.textDocument = textDocument;
        SymbolReader.nameResolver = nameResolver;
    }
    preOrder(node, spine) {
        let s;
        switch (node.phraseType) {
            case 118 /* NamespaceDefinition */:
                s = SymbolReader.namespaceDefinition(node);
                this.nameResolver.namespaceName = s.name;
                this._addSymbol(s, false);
                return true;
            case 122 /* NamespaceUseDeclaration */:
                [this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix] =
                    SymbolReader.namespaceUseDeclaration(node);
                return true;
            case 120 /* NamespaceUseClause */:
                s = SymbolReader.namespaceUseClause(node, this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix);
                this._addSymbol(s, false);
                if (s.associated && s.associated.length > 0 && s.name) {
                    this.nameResolver.importedSymbols.push(s);
                }
                return false;
            case 43 /* ConstElement */:
                this._addSymbol(SymbolReader.constElement(node, this.lastPhpDoc), false);
                return false;
            case 85 /* FunctionDeclaration */:
                this._addSymbol(SymbolReader.functionDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 86 /* FunctionDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    SymbolReader.functionDeclarationHeader(node);
                return true;
            case 127 /* ParameterDeclaration */:
                this._addSymbol(SymbolReader.parameterDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 171 /* TypeDeclaration */:
                s = this.spine[this.spine.length - 1];
                let typeDeclarationValue = SymbolReader.typeDeclaration(node);
                s.type = s.type ? s.type.merge(typeDeclarationValue) : new TypeString(typeDeclarationValue);
                return false;
            case 28 /* ClassDeclaration */:
                this._addSymbol(SymbolReader.classDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 30 /* ClassDeclarationHeader */:
                SymbolReader.classDeclarationHeader(this.spine[this.spine.length - 1], node);
                return true;
            case 23 /* ClassBaseClause */:
                s = this.spine[this.spine.length - 1];
                let classBaseClause = SymbolReader.classBaseClause(node);
                if (s.associated) {
                    s.associated.push(classBaseClause);
                }
                else {
                    s.associated = [classBaseClause];
                }
                return false;
            case 31 /* ClassInterfaceClause */:
                s = this.spine[this.spine.length - 1];
                let classInterfaceClause = SymbolReader.classInterfaceClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, classInterfaceClause);
                }
                else {
                    s.associated = classInterfaceClause;
                }
                return false;
            case 101 /* InterfaceDeclaration */:
                this._addSymbol(SymbolReader.interfaceDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 103 /* InterfaceDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    SymbolReader.interfaceDeclarationHeader(node);
                return false;
            case 100 /* InterfaceBaseClause */:
                s = this.spine[this.spine.length - 1];
                let interfaceBaseClause = SymbolReader.interfaceBaseClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, interfaceBaseClause);
                }
                else {
                    s.associated = interfaceBaseClause;
                }
                return false;
            case 163 /* TraitDeclaration */:
                this._addSymbol(SymbolReader.traitDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 165 /* TraitDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    SymbolReader.traitDeclarationHeader(node);
                return false;
            case 25 /* ClassConstDeclaration */:
                this.classConstDeclarationModifier =
                    SymbolReader.classConstantDeclaration(node);
                return true;
            case 26 /* ClassConstElement */:
                this._addSymbol(SymbolReader.classConstElement(this.classConstDeclarationModifier, node, this.lastPhpDoc), false);
                return false;
            case 135 /* PropertyDeclaration */:
                this.propertyDeclarationModifier =
                    SymbolReader.propertyDeclaration(node);
                return true;
            case 136 /* PropertyElement */:
                this._addSymbol(SymbolReader.propertyElement(this.propertyDeclarationModifier, node, this.lastPhpDoc), false);
                return false;
            case 168 /* TraitUseClause */:
                s = this.spine[this.spine.length - 1];
                let traitUseClause = SymbolReader.traitUseClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, traitUseClause);
                }
                else {
                    s.associated = traitUseClause;
                }
                return false;
            case 111 /* MethodDeclaration */:
                this._addSymbol(SymbolReader.methodDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 113 /* MethodDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    SymbolReader.methodDeclarationHeader(node);
                return true;
            case 108 /* MemberModifierList */:
                this.spine[this.spine.length - 1].modifiers =
                    SymbolReader.memberModifierList(node);
                return false;
            case 2 /* AnonymousClassDeclaration */:
                this._addSymbol(SymbolReader.anonymousClassDeclaration(node), true);
                return true;
            case 4 /* AnonymousFunctionCreationExpression */:
                this._addSymbol(SymbolReader.anonymousFunctionCreationExpression(node), true);
                return true;
            case 7 /* AnonymousFunctionUseVariable */:
                this._addSymbol(SymbolReader.anonymousFunctionUseVariable(node), false);
                return false;
            case 154 /* SimpleVariable */:
                s = SymbolReader.simpleVariable(node);
                if (s && !this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return false;
            case undefined:
                this._token(node);
                return false;
            default:
                return true;
        }
    }
    postOrder(node, spine) {
        switch (node.phraseType) {
            case 118 /* NamespaceDefinition */:
                if (node.statementList) {
                    this.nameResolver.namespaceName = '';
                }
                break;
            case 85 /* FunctionDeclaration */:
            case 127 /* ParameterDeclaration */:
            case 28 /* ClassDeclaration */:
            case 101 /* InterfaceDeclaration */:
            case 163 /* TraitDeclaration */:
            case 111 /* MethodDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
            case 4 /* AnonymousFunctionCreationExpression */:
                this.spine.pop();
                break;
            default:
                break;
        }
    }
    _variableExists(name) {
        let s = this.spine[this.spine.length - 1];
        if (!s.children) {
            return false;
        }
        let mask = 128 /* Parameter */ | 256 /* Variable */;
        for (let n = 0, l = s.children.length; n < l; ++n) {
            if ((s.children[n].kind & mask) > 0 && s.name === name) {
                return true;
            }
        }
        return false;
    }
    _token(t) {
        switch (t.tokenType) {
            case 160 /* DocumentComment */:
                let phpDocTokenText = SymbolReader.tokenText(t);
                this.lastPhpDoc = phpDoc_1.PhpDocParser.parse(phpDocTokenText);
                this.lastPhpDocLocation = {
                    uri: this.textDocument.uri,
                    range: {
                        start: this.textDocument.positionAtOffset(t.offset),
                        end: this.textDocument.positionAtOffset(t.offset + phpDocTokenText.length)
                    }
                };
                break;
            case 119 /* CloseBrace */:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }
    }
    _addSymbol(symbol, pushToSpine) {
        if (!symbol) {
            return;
        }
        let parent = this.spine[this.spine.length - 1];
        if (!parent.children) {
            parent.children = [];
        }
        if (parent.name) {
            symbol.scope = parent.name;
        }
        parent.children.push(symbol);
        if (pushToSpine) {
            this.spine.push(symbol);
        }
    }
}
exports.SymbolReader = SymbolReader;
(function (SymbolReader) {
    function tokenText(t) {
        return t ? SymbolReader.textDocument.textAtOffset(t.offset, t.length) : '';
    }
    SymbolReader.tokenText = tokenText;
    function nameTokenToFqn(t) {
        let name = tokenText(t);
        return name ? SymbolReader.nameResolver.resolveRelative(name) : '';
    }
    SymbolReader.nameTokenToFqn = nameTokenToFqn;
    function phraseLocation(p) {
        if (!p) {
            return null;
        }
        let startToken, endToken;
        [startToken, endToken] = parse_1.ParseTree.tokenRange(p);
        if (!startToken || !endToken) {
            return null;
        }
        return {
            uri: SymbolReader.textDocument.uri,
            range: {
                start: SymbolReader.textDocument.positionAtOffset(startToken.offset),
                end: SymbolReader.textDocument.positionAtOffset(endToken.offset + endToken.length)
            }
        };
    }
    SymbolReader.phraseLocation = phraseLocation;
    /**
     *
     * Uses phrase range to provide "unique" name
     */
    function anonymousName(node) {
        let range = phraseLocation(node).range;
        let suffix = [range.start.line, range.end.line, range.end.line, range.end.character].join('.');
        return '.anonymous.' + suffix;
    }
    SymbolReader.anonymousName = anonymousName;
    function functionDeclaration(node, phpDoc) {
        let s = {
            kind: 64 /* Function */,
            name: '',
            location: phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(SymbolReader.nameResolver);
            }
        }
        return s;
    }
    SymbolReader.functionDeclaration = functionDeclaration;
    function functionDeclarationHeader(node) {
        return nameTokenToFqn(node.name);
    }
    SymbolReader.functionDeclarationHeader = functionDeclarationHeader;
    function parameterDeclaration(node, phpDoc) {
        let s = {
            kind: 128 /* Parameter */,
            name: tokenText(node.name),
            location: phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                let type = new TypeString(tag.typeString).nameResolve(SymbolReader.nameResolver);
                s.type = s.type ? s.type.merge(type) : type;
            }
        }
        return s;
    }
    SymbolReader.parameterDeclaration = parameterDeclaration;
    function typeDeclaration(node) {
        return node.name.phraseType ?
            qualifiedName(node.name, 1 /* Class */) :
            tokenText(node.name);
    }
    SymbolReader.typeDeclaration = typeDeclaration;
    function qualifiedName(node, kind) {
        if (!node || !node.name) {
            return '';
        }
        let name = namespaceName(node.name);
        switch (node.phraseType) {
            case 139 /* QualifiedName */:
                return SymbolReader.nameResolver.resolveNotFullyQualified(name, kind);
            case 142 /* RelativeQualifiedName */:
                return SymbolReader.nameResolver.resolveRelative(name);
            case 83 /* FullyQualifiedName */:
            default:
                return name;
        }
    }
    SymbolReader.qualifiedName = qualifiedName;
    function constElement(node, phpDoc) {
        let s = {
            kind: 8 /* Constant */,
            name: nameTokenToFqn(node.name),
            location: phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(SymbolReader.nameResolver);
            }
        }
        return s;
    }
    SymbolReader.constElement = constElement;
    function classConstantDeclaration(node) {
        return node.modifierList ?
            modifierListElementsToSymbolModifier(node.modifierList.elements) :
            0 /* None */;
    }
    SymbolReader.classConstantDeclaration = classConstantDeclaration;
    function classConstElement(modifiers, node, phpDoc) {
        let s = {
            kind: 8 /* Constant */,
            modifiers: modifiers,
            name: identifier(node.name),
            location: phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(SymbolReader.nameResolver);
            }
        }
        return s;
    }
    SymbolReader.classConstElement = classConstElement;
    function methodDeclaration(node, phpDoc) {
        let s = {
            kind: 32 /* Method */,
            name: '',
            location: phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(SymbolReader.nameResolver);
            }
        }
        return s;
    }
    SymbolReader.methodDeclaration = methodDeclaration;
    function memberModifierList(node) {
        return modifierListElementsToSymbolModifier(node.elements);
    }
    SymbolReader.memberModifierList = memberModifierList;
    function methodDeclarationHeader(node) {
        return identifier(node.name);
    }
    SymbolReader.methodDeclarationHeader = methodDeclarationHeader;
    function propertyDeclaration(node) {
        return node.modifierList ?
            modifierListElementsToSymbolModifier(node.modifierList.elements) :
            0 /* None */;
    }
    SymbolReader.propertyDeclaration = propertyDeclaration;
    function propertyElement(modifiers, node, phpDoc) {
        let s = {
            kind: 16 /* Property */,
            name: tokenText(node.name),
            modifiers: modifiers,
            location: phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(SymbolReader.nameResolver);
            }
        }
        return s;
    }
    SymbolReader.propertyElement = propertyElement;
    function identifier(node) {
        return tokenText(node.name);
    }
    SymbolReader.identifier = identifier;
    function interfaceDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 2 /* Interface */,
            name: '',
            location: phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    SymbolReader.interfaceDeclaration = interfaceDeclaration;
    function phpDocMembers(phpDoc, phpDocLoc) {
        let magic = phpDoc.propertyTags;
        let symbols = [];
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(propertyTagToSymbol(magic[n], phpDocLoc));
        }
        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(methodTagToSymbol(magic[n], phpDocLoc));
        }
        return symbols;
    }
    SymbolReader.phpDocMembers = phpDocMembers;
    function methodTagToSymbol(tag, phpDocLoc) {
        let s = {
            kind: 32 /* Method */,
            modifiers: 256 /* Magic */,
            name: tag.name,
            type: new TypeString(tag.typeString).nameResolve(SymbolReader.nameResolver),
            description: tag.description,
            children: [],
            location: phpDocLoc
        };
        if (!tag.parameters) {
            return s;
        }
        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(magicMethodParameterToSymbol(tag.parameters[n], phpDocLoc));
        }
        return s;
    }
    SymbolReader.methodTagToSymbol = methodTagToSymbol;
    function magicMethodParameterToSymbol(p, phpDocLoc) {
        return {
            kind: 128 /* Parameter */,
            name: p.name,
            modifiers: 256 /* Magic */,
            type: new TypeString(p.typeString).nameResolve(SymbolReader.nameResolver),
            location: phpDocLoc
        };
    }
    SymbolReader.magicMethodParameterToSymbol = magicMethodParameterToSymbol;
    function propertyTagToSymbol(t, phpDocLoc) {
        return {
            kind: 16 /* Property */,
            name: t.name,
            modifiers: magicPropertyModifier(t) | 256 /* Magic */,
            type: new TypeString(t.typeString).nameResolve(SymbolReader.nameResolver),
            description: t.description,
            location: phpDocLoc
        };
    }
    SymbolReader.propertyTagToSymbol = propertyTagToSymbol;
    function magicPropertyModifier(t) {
        switch (t.tagName) {
            case '@property-read':
                return 64 /* ReadOnly */;
            case '@property-write':
                return 128 /* WriteOnly */;
            default:
                return 0 /* None */;
        }
    }
    SymbolReader.magicPropertyModifier = magicPropertyModifier;
    function interfaceDeclarationHeader(node) {
        return nameTokenToFqn(node.name);
    }
    SymbolReader.interfaceDeclarationHeader = interfaceDeclarationHeader;
    function interfaceBaseClause(node) {
        let mapFn = (name) => {
            return {
                kind: 2 /* Interface */,
                name: name
            };
        };
        return qualifiedNameList(node.nameList).map(mapFn);
    }
    SymbolReader.interfaceBaseClause = interfaceBaseClause;
    function traitDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 4 /* Trait */,
            name: '',
            location: phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    SymbolReader.traitDeclaration = traitDeclaration;
    function traitDeclarationHeader(node) {
        return nameTokenToFqn(node.name);
    }
    SymbolReader.traitDeclarationHeader = traitDeclarationHeader;
    function classDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 1 /* Class */,
            name: '',
            location: phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    SymbolReader.classDeclaration = classDeclaration;
    function classDeclarationHeader(s, node) {
        if (node.modifier) {
            s.modifiers = modifierTokenToSymbolModifier(node.modifier);
        }
        s.name = nameTokenToFqn(node.name);
        return s;
    }
    SymbolReader.classDeclarationHeader = classDeclarationHeader;
    function classBaseClause(node) {
        return {
            kind: 1 /* Class */,
            name: qualifiedName(node.name, 1 /* Class */)
        };
    }
    SymbolReader.classBaseClause = classBaseClause;
    function classInterfaceClause(node) {
        let mapFn = (name) => {
            return {
                kind: 2 /* Interface */,
                name: name
            };
        };
        return qualifiedNameList(node.nameList).map(mapFn);
    }
    SymbolReader.classInterfaceClause = classInterfaceClause;
    function traitUseClause(node) {
        let mapFn = (name) => {
            return {
                kind: 4 /* Trait */,
                name: name
            };
        };
        return qualifiedNameList(node.nameList).map(mapFn);
    }
    SymbolReader.traitUseClause = traitUseClause;
    function anonymousClassDeclaration(node) {
        return {
            kind: 1 /* Class */,
            name: anonymousName(node),
            modifiers: 512 /* Anonymous */,
            location: phraseLocation(node)
        };
    }
    SymbolReader.anonymousClassDeclaration = anonymousClassDeclaration;
    function anonymousFunctionCreationExpression(node) {
        return {
            kind: 64 /* Function */,
            name: anonymousName(node),
            modifiers: 512 /* Anonymous */,
            location: phraseLocation(node)
        };
    }
    SymbolReader.anonymousFunctionCreationExpression = anonymousFunctionCreationExpression;
    function anonymousFunctionUseVariable(node) {
        return {
            kind: 256 /* Variable */,
            name: tokenText(node.name),
            location: phraseLocation(node)
        };
    }
    SymbolReader.anonymousFunctionUseVariable = anonymousFunctionUseVariable;
    function simpleVariable(node) {
        if (!node.name || node.name.tokenType !== 84 /* VariableName */) {
            return null;
        }
        return {
            kind: 256 /* Variable */,
            name: tokenText(node.name),
            location: phraseLocation(node)
        };
    }
    SymbolReader.simpleVariable = simpleVariable;
    function qualifiedNameList(node) {
        let names = [];
        let name;
        if (!node) {
            return names;
        }
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            name = qualifiedName(node.elements[n], 1 /* Class */);
            if (name) {
                names.push(name);
            }
        }
        return names;
    }
    SymbolReader.qualifiedNameList = qualifiedNameList;
    function modifierListElementsToSymbolModifier(tokens) {
        let flag = 0 /* None */;
        if (!tokens || tokens.length < 1) {
            return flag;
        }
        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= modifierTokenToSymbolModifier(tokens[n]);
        }
        return flag;
    }
    SymbolReader.modifierListElementsToSymbolModifier = modifierListElementsToSymbolModifier;
    function modifierTokenToSymbolModifier(t) {
        switch (t.tokenType) {
            case 55 /* Public */:
                return 1 /* Public */;
            case 56 /* Protected */:
                return 2 /* Protected */;
            case 54 /* Private */:
                return 4 /* Private */;
            case 2 /* Abstract */:
                return 16 /* Abstract */;
            case 31 /* Final */:
                return 8 /* Final */;
            case 60 /* Static */:
                return 32 /* Static */;
            default:
                return 0 /* None */;
        }
    }
    SymbolReader.modifierTokenToSymbolModifier = modifierTokenToSymbolModifier;
    function namespaceName(node) {
        if (!node || !node.parts || node.parts.length < 1) {
            return null;
        }
        let parts = [];
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            parts.push(tokenText(node.parts[n]));
        }
        return parts.join('\\');
    }
    SymbolReader.namespaceName = namespaceName;
    function concatNamespaceName(prefix, name) {
        if (!name) {
            return null;
        }
        else if (!prefix) {
            return name;
        }
        else {
            return prefix + '\\' + name;
        }
    }
    SymbolReader.concatNamespaceName = concatNamespaceName;
    function namespaceUseClause(node, kind, prefix) {
        let s = {
            kind: kind ? kind : 1 /* Class */,
            name: node.aliasingClause ? tokenText(node.aliasingClause.alias) : null,
            associated: [],
            location: phraseLocation(node)
        };
        let fqn = concatNamespaceName(prefix, namespaceName(node.name));
        if (!fqn) {
            return s;
        }
        s.associated.push({ kind: s.kind, name: fqn });
        if (!node.aliasingClause) {
            s.name = fqn.split('\\').pop();
        }
        return s;
    }
    SymbolReader.namespaceUseClause = namespaceUseClause;
    function tokenToSymbolKind(t) {
        switch (t.tokenType) {
            case 35 /* Function */:
                return 64 /* Function */;
            case 12 /* Const */:
                return 8 /* Constant */;
            default:
                return 0 /* None */;
        }
    }
    SymbolReader.tokenToSymbolKind = tokenToSymbolKind;
    function namespaceUseDeclaration(node) {
        return [
            node.kind ? tokenToSymbolKind(node.kind) : 0 /* None */,
            node.prefix ? namespaceName(node.prefix) : null
        ];
    }
    SymbolReader.namespaceUseDeclaration = namespaceUseDeclaration;
    function namespaceDefinition(node) {
        return {
            kind: 512 /* Namespace */,
            name: namespaceName(node.name),
            location: phraseLocation(node),
            children: []
        };
    }
    SymbolReader.namespaceDefinition = namespaceDefinition;
})(SymbolReader = exports.SymbolReader || (exports.SymbolReader = {}));
class SymbolIndex {
    constructor() {
        this._nodeArray = [];
        this._binarySearch = new types_1.BinarySearch(this._nodeArray);
        this._collator = new Intl.Collator('en');
    }
    add(item) {
        let suffixes = this._symbolSuffixes(item);
        let node;
        for (let n = 0; n < suffixes.length; ++n) {
            node = this._nodeFind(suffixes[n]);
            if (node) {
                node.items.push(item);
            }
            else {
                this._insertNode({ key: suffixes[n], items: [item] });
            }
        }
    }
    addMany(items) {
        for (let n = 0; n < items.length; ++n) {
            this.add(items[n]);
        }
    }
    remove(item) {
        let suffixes = this._symbolSuffixes(item);
        let node;
        let i;
        for (let n = 0; n < suffixes.length; ++n) {
            node = this._nodeFind(suffixes[n]);
            if (!node) {
                continue;
            }
            i = node.items.indexOf(item);
            if (i !== -1) {
                node.items.splice(i, 1);
                if (!node.items.length) {
                    this._deleteNode(node);
                }
            }
        }
    }
    removeMany(items) {
        for (let n = 0; n < items.length; ++n) {
            this.remove(items[n]);
        }
    }
    match(text) {
        let nodes = this._nodeMatch(text);
        let matches = [];
        for (let n = 0; n < nodes.length; ++n) {
            Array.prototype.push.apply(matches, nodes[n].items);
        }
        return Array.from(new Set(matches));
    }
    _nodeMatch(text) {
        let collator = this._collator;
        let lcText = text.toLowerCase();
        let compareLowerFn = (n) => {
            return collator.compare(n.key, lcText);
        };
        let compareUpperFn = (n) => {
            return n.key.slice(0, lcText.length) === lcText ? -1 : 1;
        };
        return this._binarySearch.range(compareLowerFn, compareUpperFn);
    }
    _nodeFind(text) {
        let lcText = text.toLowerCase();
        let collator = this._collator;
        let compareFn = (n) => {
            return collator.compare(n.key, lcText);
        };
        return this._binarySearch.find(compareFn);
    }
    _insertNode(node) {
        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });
        this._nodeArray.splice(rank, 0, node);
    }
    _deleteNode(node) {
        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });
        if (this._nodeArray[rank] === node) {
            this._nodeArray.splice(rank, 1);
        }
    }
    _symbolSuffixes(s) {
        let suffixes = PhpSymbol.suffixArray(s);
        let acronym = PhpSymbol.acronym(s);
        if (acronym.length > 1) {
            suffixes.push(acronym);
        }
        return suffixes;
    }
}
exports.SymbolIndex = SymbolIndex;
