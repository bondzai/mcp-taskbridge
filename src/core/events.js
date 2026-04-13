export const TaskEvents = Object.freeze({
  CREATED: "task.created",
  CLAIMED: "task.claimed",
  PROGRESS: "task.progress",
  COMPLETED: "task.completed",
  FAILED: "task.failed",
  UPDATED: "task.updated",
  ARCHIVED: "task.archived",
  UNARCHIVED: "task.unarchived",
  DELETED: "task.deleted",
});

export const createEventBus = () => {
  const subscribers = new Set();
  return {
    subscribe(handler) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
    async emit(event, data) {
      for (const handler of subscribers) {
        try {
          await handler(event, data);
        } catch {
          // subscriber errors never break the core flow
        }
      }
    },
    size() {
      return subscribers.size;
    },
  };
};
