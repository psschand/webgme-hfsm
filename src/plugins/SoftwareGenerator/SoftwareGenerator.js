/*globals define*/
/*jshint node:true, browser:true*/

/**
 * Generated by PluginGenerator 1.7.0 from webgme on Fri Sep 09 2016 09:21:15 GMT-0500 (Central Daylight Time).
 * A plugin that inherits from the PluginBase. To see source code documentation about available
 * properties and methods visit %host%/docs/source/PluginBase.html.
 */

define([
    'plugin/PluginConfig',
    'text!./metadata.json',
    'plugin/PluginBase',
    'common/util/ejs', // for ejs templates
    './templates/Templates',
    'webgme-to-json/webgme-to-json',
    'hfsm/processor',
    'q'
], function (
    PluginConfig,
    pluginMetadata,
    PluginBase,
    ejs,
    TEMPLATES,
    webgmeToJson,
    processor,
    Q) {
    'use strict';

    pluginMetadata = JSON.parse(pluginMetadata);

    /**
     * Initializes a new instance of SoftwareGenerator.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin SoftwareGenerator.
     * @constructor
     */
    var SoftwareGenerator = function () {
        // Call base class' constructor.
        PluginBase.call(this);
        this.pluginMetadata = pluginMetadata;
    };

    /**
     * Metadata associated with the plugin. Contains id, name, version, description, icon, configStructue etc.
     * This is also available at the instance at this.pluginMetadata.
     * @type {object}
     */
    SoftwareGenerator.metadata = pluginMetadata;

    // Prototypical inheritance from PluginBase.
    SoftwareGenerator.prototype = Object.create(PluginBase.prototype);
    SoftwareGenerator.prototype.constructor = SoftwareGenerator;

    SoftwareGenerator.prototype.notify = function(level, msg) {
	var self = this;
	var prefix = self.projectId + '::' + self.projectName + '::' + level + '::';
	var max_msg_len = 100;
	if (level=='error')
	    self.logger.error(msg);
	else if (level=='debug')
	    self.logger.debug(msg);
	else if (level=='info')
	    self.logger.info(msg);
	else if (level=='warning')
	    self.logger.warn(msg);
	self.createMessage(self.activeNode, msg, level);
	self.sendNotification(prefix+msg);
    };

    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    SoftwareGenerator.prototype.main = function (callback) {
        // Use self to access core, project, result, logger etc from PluginBase.
        // These are all instantiated at this point.
        var self = this,
            nodeObject;

        // Default fails
        self.result.success = false;

	var currentConfig = self.getCurrentConfig();
	self.language = currentConfig.language;
	self.toolchain = currentConfig.toolchain;
	self.idfPath = currentConfig.idfPath;
	self.portName = currentConfig.portName;

	// the active node for this plugin is software -> project
	var projectNode = self.activeNode;
	self.projectName = self.core.getAttribute(projectNode, 'name');

	// artifact name that will be returned
	self.artifactName = self.project.projectId + '+' + self.branchName + '+' + self.projectName + '_generatedCode';

	self.projectModel = {}; // will be filled out by loadProjectModel (and associated functions)
	self.artifacts = {}; // will be filled out and used by various parts of this plugin

	webgmeToJson.notify = function(level, msg) {self.notify(level, msg);}

      	webgmeToJson.loadModel(self.core, self.rootNode, projectNode, true, true)
  	    .then(function (projectModel) {
		// make convenience members and extra data
		processor.processModel(projectModel);
		self.projectModel = projectModel.root;
		self.projectObjects = projectModel.objects;
  	    })
	    .then(function () {
		return self.generateArtifacts();
	    })
	    .then(function () {
		self.notify('info', "Generated artifacts.");
        	self.result.setSuccess(true);
        	callback(null, self.result);
	    })
	    .catch(function (err) {
		self.notify('error', err);
        	self.result.setSuccess(false);
        	callback(err, self.result);
	    })
		.done();
    };

    SoftwareGenerator.prototype.getStateDelay = function(timerPeriod) {
	var defaultTimerPeriod = 1.0;
	return parseInt(parseFloat(timerPeriod || defaultTimerPeriod) * 1000.0);
    };

    SoftwareGenerator.prototype.getChildrenByType = function(obj, type) {
	var self = this;
	var children = [];
	if (obj.childPaths) {
	    obj.childPaths.map(function(childPath) {
		var child = self.projectObjects[childPath];
		if (child.type == type) {
		    children.push(child);
		    children = children.concat(self.getChildrenByType(child, type));
		}
	    });
	}
	return children;
    };

    SoftwareGenerator.prototype.getTaskData = function(task) {
	var self = this;
	var data = {
	    'model': self.projectModel,
	    'task': task,
	    'states': self.getChildrenByType(task, 'State'),
	    stateDelay: function(timerPeriod) { return self.getStateDelay(timerPeriod); }
	};
	return data;
    };

    SoftwareGenerator.prototype.generateArtifacts = function () {
	var self = this;

	// make sure we can figure out exactly where we generated from
        self.artifacts[self.projectModel.name + '_metadata.json'] = JSON.stringify({
    	    projectID: self.project.projectId,
            commitHash: self.commitHash,
            branchName: self.branchName,
            timeStamp: (new Date()).toISOString(),
            pluginVersion: self.getVersion()
        }, null, 2);

	var headerSuffix = (self.language == 'c++') ? '.hpp' : '.h';
	var sourceSuffix = (self.language == 'c++') ? '.cpp' : '.c';

	// what data is needed by the templates
	var renderData = {
	    'model': self.projectModel,
	    'serialPort': self.portName,
	    'idfPath': self.idfPath,
	    stateDelay: function(timerPeriod) { return self.getStateDelay(timerPeriod); }
	};

	// render the main file out
	var mainKey = [
	    self.toolchain,
	    'main',
	    'main' + sourceSuffix
	].join('/');
	var mainTemplateKey = [
	    self.language,
	    'main' + sourceSuffix
	].join('/');
	self.artifacts[mainKey] = ejs.render(TEMPLATES[mainTemplateKey], renderData);
	// make component.mk file for main component
	var buildFileName = 'component.mk';
	var componentKey = [
	    self.toolchain,
	    'main',
	    buildFileName
	].join('/');
	var componentTemplateKey = [
	    self.language,
	    buildFileName
	].join('/');
	self.artifacts[componentKey] = ejs.render(TEMPLATES[componentTemplateKey], renderData);

	// for each task, render it out
	if (self.projectModel.Task_list) {
	    self.projectModel.Task_list.map(function(task) {
		var taskData = self.getTaskData(task);
		var baseKey = [
		    self.toolchain,
		    task.taskName  // component folder
		].join('/');
		// Make header file
		var headerKey = [
		    baseKey,
		    'include',
		    task.taskName + headerSuffix
		].join('/');
		var headerTemplateKey = [
		    self.language,
		    'task' + headerSuffix
		].join('/');
		self.artifacts[headerKey] = ejs.render(TEMPLATES[headerTemplateKey], taskData);
		// Make source file
		var sourceKey = [
		    baseKey,
		    task.taskName + sourceSuffix
		].join('/');
		var sourceTemplateKey = [
		    self.language,
		    'task' + sourceSuffix
		].join('/');
		self.artifacts[sourceKey] = ejs.render(TEMPLATES[sourceTemplateKey], taskData);
		// make component.mk file for the component
		var buildFileName = 'component.mk';
		var componentKey = [
		    baseKey,
		    buildFileName
		].join('/');
		var componentTemplateKey = [
		    self.language,
		    buildFileName
		].join('/');
		self.artifacts[componentKey] = ejs.render(TEMPLATES[componentTemplateKey], taskData);
		/*
		// make Kconfig file for the component
		var buildFileName = 'Kconfig';
		var componentKey = [
		    baseKey,
		    buildFileName
		].join('/');
		var componentTemplateKey = [
		    self.language,
		    buildFileName
		].join('/');
		self.artifacts[componentKey] = ejs.render(TEMPLATES[componentTemplateKey], taskData);
		*/
	    });
	}

	// figure our which artifacts we're actually rendering
	var selectedArtifactKeys = Object.keys(TEMPLATES).filter(
	    function(key) { return key.startsWith(self.toolchain + '/'); }
	);
	
	// render templates
	selectedArtifactKeys.map(function(key) {
	    self.artifacts[key] = ejs.render(TEMPLATES[key], renderData);
	    // re-render so that users' templates are accounted for
	    self.artifacts[key] = ejs.render(self.artifacts[key], renderData);
	});

	// make sure to render all libraries
	if (self.projectModel.Library_list) {
	    self.projectModel.Library_list.map(function(library) {
		if ( self.language == 'c' ) {
		    var prefix = 'c/src/';
		    var headerFileName = library.name + '.h';
		    var includeGuard = library.name.toUpperCase() + '_INCLUDE_GUARD_';
		    self.artifacts[prefix+headerFileName] = "#ifndef " + includeGuard + "\n#define " + includeGuard +'\n';
		    self.artifacts[prefix+headerFileName] += library.definitions;
		    if (library.Event_list) {
			library.Event_list.map(function(event) {
			    self.artifacts[prefix+headerFileName] += '\n'+event.definition;
			});
		    }
		    self.artifacts[prefix+headerFileName] += "\n#endif //"+includeGuard;

		    var sourceFileName = library.name + '.c';
		    self.artifacts[prefix+sourceFileName] = '#include "' + headerFileName + '"';
		    self.artifacts[prefix+sourceFileName] += '\n' + library.code;
		}
	    });
	}

	var fileNames = Object.keys(self.artifacts);
	var artifact = self.blobClient.createArtifact(self.artifactName);
	var deferred = new Q.defer();
	artifact.addFiles(self.artifacts, function(err) {
	    if (err) {
		deferred.reject(err.message);
		return;
	    }
	    self.blobClient.saveAllArtifacts(function(err, hashes) {
		if (err) {
		    deferred.reject(err.message);
		    return;
		}
		self.result.addArtifact(hashes[0]);
		deferred.resolve();
	    });
	});
	return deferred.promise;
    };

    return SoftwareGenerator;
});
