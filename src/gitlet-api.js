var fs = require('fs');
var files = require('./files');
var index = require('./index');
var objects = require('./objects');
var refs = require('./refs');
var diff = require('./diff');
var util = require('./util');

var gitletApi = module.exports = {
  init: function(_) {
    if (files.inRepo()) { return; }

    files.writeFilesFromTree({
      ".gitlet": {
        HEAD: "ref: refs/heads/master\n",
        objects: {},
        refs: {
          heads: {},
          remotes: {
            origin: {}
          },
        }
      }
    });
  },

  add: function(path, _) {
    files.assertInRepo();

    var addedFiles = files.lsRecursive(path);
    if (addedFiles.length === 0) {
      throw "fatal: pathspec '" + files.pathFromRepoRoot(path) + "' did not match any files";
    } else {
      for (var i = 0; i < addedFiles.length; i++) {
        this.update_index(addedFiles[i], { add: true });
      }
    }
  },

  update_index: function(path, opts) {
    files.assertInRepo();
    opts = opts || {};

    var pathFromRoot = files.pathFromRepoRoot(path)
    if (!fs.existsSync(path)) {
      throw "error: " + pathFromRoot + ": does not exist\n" +
        "fatal: Unable to process path " + pathFromRoot;
    } else if (fs.statSync(path).isDirectory()) {
      throw "error: " + pathFromRoot + ": is a directory - add files inside instead\n" +
        "fatal: Unable to process path " + pathFromRoot;
    } else if (!index.readHasFile(path) && opts.add === undefined) {
      throw "error: " + pathFromRoot  +
        ": cannot add to the index - missing --add option?\n" +
        "fatal: Unable to process path " + pathFromRoot;
    } else {
      index.writeFile(path);
    }
  },

  hash_object: function(file, opts) {
    files.assertInRepo();
    opts = opts || {};

    if (!fs.existsSync(file)) {
      throw "fatal: Cannot open '" + file + "': No such file or directory"
    } else {
      var fileContents = files.read(file);
      if (opts.w) {
        return objects.write(fileContents);
      }

      return util.hash(fileContents);
    }
  },

  write_tree: function(_) {
    files.assertInRepo();
    return objects.writeTree(files.nestFlatTree(index.read()));
  },

  commit: function(opts) {
    files.assertInRepo();

    if (Object.keys(index.read()).length === 0) {
      throw "# On branch master\n#\n# Initial commit\n#\n" +
        "nothing to commit (create/copy files and use 'git add' to track)";
    } else {
      var headHash = refs.readHash("HEAD");
      var treeHash = this.write_tree();

      if (headHash !== undefined &&
          treeHash === objects.treeHash(objects.read(headHash))) {
        throw "# On " + refs.readCurrentBranchName() + "\n" +
          "nothing to commit, working directory clean";
      } else {
        var isFirstCommit = refs.readHash("HEAD") === undefined;
        var parentHashes = isFirstCommit ? [] : [refs.readHash("HEAD")];
        var commmitHash = objects.write(objects.composeCommit(treeHash, opts.m, parentHashes));
        this.update_ref("HEAD", commmitHash);
        return "[" + refs.readCurrentBranchName() + " " + commmitHash + "] " + opts.m;
      }
    }
  },

  branch: function(name, _) {
    files.assertInRepo();

    if (name === undefined) {
      return refs.readLocalHeads().map(function(branchName) {
        var marker = branchName === refs.readCurrentBranchName() ? "* " : "  ";
        return marker + branchName;
      }).join("\n") + "\n";
    } else if (refs.readHash("HEAD") === undefined) {
      throw "fatal: Not a valid object name: '" + refs.readCurrentBranchName() + "'.";
    } else {
      refs.write(refs.nameToBranchRef(name), refs.readHash("HEAD"));
    }
  },

  update_ref: function(refToUpdate, refToUpdateTo, _) {
    files.assertInRepo();

    if (!refs.isRef(refToUpdate)) {
      throw "fatal: Cannot lock the ref " + refToUpdate + ".";
    } else {
      var hash = objects.read(refToUpdateTo) ? refToUpdateTo : refs.readHash(refToUpdateTo);
      if (!objects.readExists(hash)) {
        throw "fatal: " + refToUpdateTo + ": not a valid SHA1";
      } else if (!(objects.type(objects.read(hash)) === "commit")) {
        throw "error: Trying to write non-commit object " + hash + " to branch " +
          refs.readTerminalRef(refToUpdate) + "\n" +
          "fatal: Cannot update the ref " + refToUpdate;
      } else {
        refs.write(refs.readTerminalRef(refToUpdate), hash);
      }
    }
  },

  checkout: function(ref, _) {
    files.assertInRepo();

    var hash = objects.read(ref) ? ref : refs.readHash(ref);

    if (!objects.readExists(hash)) {
      throw "error: pathspec " + ref + " did not match any file(s) known to gitlet."
    }
  },

  diff: function(ref1, ref2, opts) {
    files.assertInRepo();

    var hash1 = objects.read(ref1) ? ref1 : refs.readHash(ref1);
    var hash2 = objects.read(ref2) ? ref2 : refs.readHash(ref2);

    if (ref1 !== undefined && hash1 === undefined) {
      throw "fatal: ambiguous argument " + ref1 + ": unknown revision";
    } else if (ref2 !== undefined && hash2 === undefined) {
      throw "fatal: ambiguous argument " + ref2 + ": unknown revision";
    } else {
      if (opts["name-status"] !== true) {
        throw "unsupported"; // for now
      } else {
        if (ref1 === undefined && ref2 === undefined) {
          return diff.toString(diff.nameStatus(index.read(), index.readWorkingCopyIndex()));
        } else if (ref2 === undefined) {
          return diff.toString(diff.nameStatus(diff.readCommitIndex(hash1),
                                               index.readWorkingCopyIndex()));
        } else {
          return diff.toString(diff.nameStatus(diff.readCommitIndex(hash1),
                                               diff.readCommitIndex(hash2)));
        }
      }
    }
  }
};
