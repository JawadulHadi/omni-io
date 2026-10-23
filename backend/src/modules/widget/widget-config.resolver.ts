import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/auth.decorators';
import { WidgetConfigService } from './widget-config.service';
import { WidgetConfig, WidgetThemeInput } from './widget.models';

@Resolver()
export class WidgetConfigResolver {
  constructor(private readonly widget: WidgetConfigService) {}

  @Query(() => WidgetConfig)
  @Roles('viewer')
  widgetConfig() {
    return this.widget.get();
  }

  @Mutation(() => WidgetConfig)
  @Roles('admin')
  updateWidgetTheme(@Args('input') input: WidgetThemeInput) {
    return this.widget.updateTheme(input);
  }

  @Mutation(() => WidgetConfig)
  @Roles('admin')
  rotateWidgetKey() {
    return this.widget.rotateKey();
  }
}
