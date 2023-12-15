
#### File ingestion error handling

There are a number of paths within the file ingestion workflow that could result in an error. Each step in the state machine that can generate an error conditions is listed below - for further details on the entire ingestion workflow please to the **System architecture** section, which goes through each step in more detail.


#### Error handler

Each of the possible error conditions will be passed through a single error handling function. This is responsible for performing the following tasks:

-   Move the source audio file from the `InputBucketRawAudio` folder in the input bucket to the `InputBucketFailedTranscriptions` folder in the input bucket
-   Remove any temporary audio file created for the Language Detection task, which under normal circumstances would be deleted

No attempt will be made by the system to re-try any of these files, and you should periodically review the files in the `InputBucketFailedTranscriptions`.


#### State-specific error conditions

A number of workflow states have direct paths to the error handler function. If you look in the Step Functions execution history for the failed file then you will see which state caused the workflow to move to the error state.


##### WaitForLangDetectTranscribe / WaitForMainTranscribe 

The first variant of this is for the Language Detection job, and the second if for the main transcription job.

This step is intended to respond to the event generated by Amazon Transcribe when the job has completed. This will throw an error if that event message does not contain a valid `jobName` from Amazon Transcribe - clearly this should not happen under normal circumstances, but is here as a fail-safe. There is no specific remediation for this error, and re-trying the file should solve the issue.


##### LangDetectionComplete?

If the Language Detection Amazon Transcribe job fails to complete for a third time then the workflow will fail. This is likely due to the length of the audio file being too short, as the Language Detection feature needs to have 30 seconds of audio in order to reliably function - it can work on less if the language choice is clear, but this isn't guaranteed. There is no remediation for this error other than trying to be more specific with the preferred language within the application configuration and then re-submitting the file, but this may not be operationally feasible as such a change would affect all incoming audio files.

##### TranscribeComplete? 

If the main transcription Amazon Transcribe job fails to complete for a third time then the workflow will fail. This is not something that will happen often, and is typically due to some artefact in the audio causing the job with the given configuration. You should re-try submitting this file one more time, but if the problem persists then you should contact AWS Support for assistance.


##### TranscribeStarted?

If Amazon Transcribe failed to start the transcription job as requested then the workflow will fail. Typically this happens if one of Amazon Transcribe's validation rules fails, such as trying to force a feature to use a specific language that isn't supported; e.g. if you edited the configuration value for `ContentRedactionLanguages` to include unsupported languages, and then submitted an audio file in that language, then Amazon Transcribe would raise an error and would not start the job.