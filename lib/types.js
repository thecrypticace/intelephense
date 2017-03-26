/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
class Event {
    constructor() {
        this._subscribed = [];
    }
    subscribe(handler) {
        this._subscribed.push(handler);
        let index = this._subscribed.length - 1;
        let subscribed = this._subscribed;
        return () => {
            subscribed.splice(index, 1);
        };
    }
    trigger(args) {
        let handler;
        for (let n = 0; n < this._subscribed.length; ++n) {
            handler = this._subscribed[n];
            handler(args);
        }
    }
}
exports.Event = Event;
class TreeTraverser {
    constructor(spine) {
        this.spine = spine;
    }
    get node() {
        return this.spine.length ? this.spine[this.spine.length - 1] : null;
    }
    traverse(visitor) {
        this._traverse(this.node, visitor, this.spine.slice(0));
    }
    filter(predicate) {
        let visitor = new FilterVisitor(predicate);
        this.traverse(visitor);
        return visitor.array;
    }
    find(predicate) {
        let visitor = new FindVisitor(predicate);
        this.traverse(visitor);
        if (visitor.found) {
            this.spine = visitor.found;
            return this.node;
        }
        return null;
    }
    prevSibling() {
        if (this.spine.length < 2) {
            return null;
        }
        let parent = this.spine[this.spine.length - 2];
        let childIndex = parent.children.indexOf(this);
        if (childIndex > 0) {
            this.spine.pop();
            this.spine.push(parent.children[childIndex - 1]);
            return this.node;
        }
        else {
            return null;
        }
    }
    nextSibling() {
        if (this.spine.length < 2) {
            return null;
        }
        let parent = this.spine[this.spine.length - 2];
        let childIndex = parent.children.indexOf(this);
        if (childIndex < parent.children.length - 1) {
            this.spine.pop();
            this.spine.push(parent.children[childIndex + 1]);
            return this.node;
        }
        else {
            return null;
        }
    }
    ancestor(predicate) {
        for (let n = this.spine.length - 2; n >= 0; --n) {
            if (predicate(this.spine[n])) {
                this.spine = this.spine.slice(0, n + 1);
                return this.node;
            }
        }
        return null;
    }
    _traverse(treeNode, visitor, spine) {
        if (visitor.haltTraverse) {
            return;
        }
        let descend = true;
        if (visitor.preOrder) {
            descend = visitor.preOrder(treeNode, spine);
            if (visitor.haltTraverse) {
                return;
            }
        }
        if (treeNode.children && descend) {
            spine.push(treeNode);
            for (let n = 0, l = treeNode.children.length; n < l; ++n) {
                this._traverse(treeNode.children[n], visitor, spine);
                if (visitor.haltTraverse) {
                    return;
                }
            }
            spine.pop();
        }
        if (visitor.postOrder) {
            visitor.postOrder(treeNode, spine);
        }
    }
}
exports.TreeTraverser = TreeTraverser;
class FilterVisitor {
    constructor(predicate) {
        this._predicate = predicate;
        this._array = [];
    }
    get array() {
        return this._array;
    }
    preOrder(node, spine) {
        if (this._predicate(node)) {
            this._array.push(node);
        }
        return true;
    }
}
class FindVisitor {
    constructor(predicate) {
        this._predicate = predicate;
        this.haltTraverse = false;
    }
    get found() {
        return this._found;
    }
    preOrder(node, spine) {
        if (this._predicate(node)) {
            this._found = spine.slice(0);
            this.found.push(node);
            this.haltTraverse = true;
            return false;
        }
        return true;
    }
}
class Debounce {
    constructor(handler, wait) {
        this._handler = handler;
        this._wait = wait;
    }
    handle(event) {
        this._lastEvent = event;
        this.interupt();
        let later = () => {
            this._handler.apply(this, this._lastEvent);
        };
        this._timer = setTimeout(later, this._wait);
    }
    interupt() {
        clearTimeout(this._timer);
        this._timer = 0;
    }
    flush() {
        if (this._timer) {
            this.interupt();
            this._handler.apply(this, this._lastEvent);
        }
    }
}
exports.Debounce = Debounce;
class ToArrayVisitor {
    constructor() {
        this._array = [];
    }
    get array() {
        return this._array;
    }
    preOrder(t, spine) {
        this._array.push(t);
        return true;
    }
}
exports.ToArrayVisitor = ToArrayVisitor;
/*
class MultiVisitor<T> implements TreeVisitor<T> {

    private _visitors: [TreeVisitor<T>, Tree<T>][];

    constructor(visitors: TreeVisitor<T>[] = []) {
        for (let n = 0; n < visitors.length; ++n) {
            this.add(visitors[n]);
        }
    }

    add(v: TreeVisitor<T>) {
        this._visitors.push([v, null]);
    }

    preOrder(t) {
        let v: [TreeVisitor<T>, Tree<T>];
        for (let n = 0; n < this._visitors.length; ++n) {
            v = this._visitors[n];
            if (!v[1]) {
                v[0].preOrder(t);
            }
        }
    }

    inOrder(t, afterChildIndex) {
        let v: [TreeVisitor<T>, Tree<T>];
        for (let n = 0; n < this._visitors.length; ++n) {
            v = this._visitors[n];
            if (!v[1]) {
                v[0].inOrder(t, afterChildIndex);
            }
        }
    }

    postOrder(t) {
        let v: [TreeVisitor<T>, Tree<T>];
        for (let n = 0; n < this._visitors.length; ++n) {
            v = this._visitors[n];
            if (v[1] === t) {
                v[1] = null;
            }
            if (!v[1]) {
                v[0].postOrder(t);
            }
        }
    }

    shouldDescend(t) {

        let v: [TreeVisitor<T>, Tree<T>];
        let descend = false;

        for (let n = 0; n < this._visitors.length; ++n) {
            v = this._visitors[n];
            if (v[1]) {
                continue;
            }
            if (v[0].shouldDescend(t)) {
                descend = true;
            } else {
                v[1] = t;
            }
        }

        return descend;

    }


}
*/
class BinarySearch {
    constructor(sortedArray) {
        this._sortedArray = sortedArray;
    }
    find(compare) {
        let result = this._search(compare);
        return result.isExactMatch ? this._sortedArray[result.rank] : null;
    }
    rank(compare) {
        return this._search(compare).rank;
    }
    range(compareLower, compareUpper) {
        let rankLower = this.rank(compareLower);
        return this._sortedArray.slice(rankLower, this._search(compareUpper, rankLower + 1).rank);
    }
    _search(compare, left = 0) {
        let right = this._sortedArray.length - 1;
        let mid = 0;
        let compareResult = 0;
        let searchResult;
        while (true) {
            if (left > right) {
                searchResult = { rank: left, isExactMatch: false };
                break;
            }
            mid = Math.floor((left + right) / 2);
            compareResult = compare(this._sortedArray[mid]);
            if (compareResult < 0) {
                left = mid + 1;
            }
            else if (compareResult > 0) {
                right = mid - 1;
            }
            else {
                searchResult = { rank: mid, isExactMatch: true };
                break;
            }
        }
        return searchResult;
    }
}
exports.BinarySearch = BinarySearch;
