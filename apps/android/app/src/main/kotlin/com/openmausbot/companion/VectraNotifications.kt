package com.openmausbot.companion

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

internal data class VectraThreadTarget(val workspace: String, val bot: String, val thread: String)

internal class VectraNotifications(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    fun progress(target: VectraThreadTarget, name: String, label: String) {
        if (!permitted()) return
        manager.createNotificationChannel(NotificationChannel("vectra-turns", "Vectrabot replies", NotificationManager.IMPORTANCE_LOW))
        val builder = builder(target, "vectra-turns", name, label)
            .setOnlyAlertOnce(true).setOngoing(true).setProgress(0, 0, true)
        manager.notify(progressId(target), builder.build())
    }

    fun finish(target: VectraThreadTarget, name: String, success: Boolean) {
        manager.cancel(progressId(target))
        if (!permitted()) return
        manager.createNotificationChannel(NotificationChannel("vectra-turns", "Vectrabot replies", NotificationManager.IMPORTANCE_LOW))
        manager.notify(target.hashCode(), builder(target, "vectra-turns", name, if (success) "Reply ready" else "The reply ended. Open Vectrabot to check it.").build())
    }

    fun action(target: VectraThreadTarget, heading: String) {
        if (!permitted()) return
        manager.createNotificationChannel(NotificationChannel("vectra-actions", "Vectrabot questions and approvals", NotificationManager.IMPORTANCE_HIGH))
        manager.notify(target.hashCode() xor 0x52caf, builder(target, "vectra-actions", heading, "Open Vectrabot to respond.").build())
    }

    fun cancelProgress(target: VectraThreadTarget) = manager.cancel(progressId(target))

    private fun progressId(target: VectraThreadTarget) = target.hashCode() xor 0x4a73c

    private fun permitted(): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun builder(target: VectraThreadTarget, channel: String, name: String, body: String): NotificationCompat.Builder {
        val uri = Uri.Builder().scheme("vectra").authority("chat")
            .appendQueryParameter("workspace", target.workspace).appendQueryParameter("bot", target.bot)
            .appendQueryParameter("thread", target.thread).build()
        val intent = Intent(context, MainActivity::class.java).setAction(ACTION_VECTRA_THREAD).setData(uri)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, target.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(context, channel).setSmallIcon(R.drawable.ic_cloud)
            .setContentTitle(name).setContentText(body).setContentIntent(pending).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
    }
}

internal const val ACTION_VECTRA_THREAD = "com.openmausbot.companion.VECTRA_THREAD"
