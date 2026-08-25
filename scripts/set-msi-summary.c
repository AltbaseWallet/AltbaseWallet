#include <glib.h>
#include <libmsi.h>
#include <stdio.h>

static int fail(GError *error, const char *operation) {
  fprintf(stderr, "%s: %s\n", operation, error ? error->message : "unknown error");
  if (error) g_error_free(error);
  return 1;
}

int main(int argc, char **argv) {
  GError *error = NULL;
  LibmsiDatabase *database;
  LibmsiSummaryInfo *summary;

  if (argc != 2) {
    fprintf(stderr, "usage: %s package.msi\n", argv[0]);
    return 2;
  }

  database = libmsi_database_new(argv[1], LIBMSI_DB_FLAGS_TRANSACT, NULL, &error);
  if (!database) return fail(error, "open MSI database");

  summary = libmsi_summary_info_new(database, 4, &error);
  if (!summary) {
    g_object_unref(database);
    return fail(error, "open MSI summary information");
  }

  if (!libmsi_summary_info_set_int(summary, LIBMSI_PROPERTY_VERSION, 500, &error) ||
      !libmsi_summary_info_set_int(summary, LIBMSI_PROPERTY_SOURCE, 2, &error) ||
      !libmsi_summary_info_set_string(summary, LIBMSI_PROPERTY_APPNAME, "Altbase Wallet Installer", &error) ||
      !libmsi_summary_info_set_int(summary, LIBMSI_PROPERTY_SECURITY, 2, &error) ||
      !libmsi_summary_info_persist(summary, &error) ||
      !libmsi_database_commit(database, &error)) {
    g_object_unref(summary);
    g_object_unref(database);
    return fail(error, "write MSI summary information");
  }

  g_object_unref(summary);
  g_object_unref(database);
  return 0;
}
