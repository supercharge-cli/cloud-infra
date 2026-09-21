#include "include/audioplayers_linux/audioplayers_linux_plugin.h"

#include <flutter_linux/flutter_linux.h>
#include <gtk/gtk.h>

#define AUDIOPLAYERS_LINUX_PLUGIN(obj)                                     \
  (G_TYPE_CHECK_INSTANCE_CAST((obj), audioplayers_linux_plugin_get_type(), \
                              AudioplayersLinuxPlugin))

struct _AudioplayersLinuxPlugin {
  GObject parent_instance;
};

G_DEFINE_TYPE(AudioplayersLinuxPlugin, audioplayers_linux_plugin, g_object_get_type())

static void audioplayers_linux_plugin_class_init(AudioplayersLinuxPluginClass* klass) {}

static void audioplayers_linux_plugin_init(AudioplayersLinuxPlugin* self) {}

void audioplayers_linux_plugin_register_with_registrar(FlPluginRegistrar* registrar) {
  (void)registrar;
}
