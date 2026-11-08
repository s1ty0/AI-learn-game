from alembic import context
from app.db import engine_for, Base
from app import models  # Registers metadata for future reviewed migrations.


def run():
    engine = engine_for()
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run()
