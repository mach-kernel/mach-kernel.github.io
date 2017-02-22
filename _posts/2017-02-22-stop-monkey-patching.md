---
published: false
---
# Stop monkeypatching everything; your library sucks

[Ruby](https://ruby-lang.org) is an awesome, dynamically typed language that has very strong OO features and excellent syntatic sugar. You can write very expressive software in few lines that looks good. It should sound like music to your ears if you're coming from some kind of [ugly templated behemoth](https://en.wikipedia.org/wiki/C%2B%2B). After all, Ruby's motto is "a programmer's best friend" -- and it is -- but only if you don't suck.

## A small case study

Let's say we have a zoo. You hire a bootcamp graduate and they prepare for you the perfect class hierarchy to manage your steed. It looks something like this.

```ruby
class Animal
  def initialize(name, sound)
    @name, @sound = name, sound
  end

  def some_important_hook
    # things
  end
  
  def do_trick
    raise NotImplementedError 'haha pls implement'
  end
end
```

Impressed by your developer's capacity to innovate, you let them go study the behavior of your animals so that they could write some software. They find out that it's quite easy to turn both of these animals into glue. During code review, an engineering manager will berate them for producing this disgusting duplicate code. 

```ruby
class Horse < Animal
  def do_trick
    "http://elmers.com/"
  end
end

class Rabbit < Animal
  def do_trick
    "http://elmers.com/"
  end
end
```

Your developer studies for a fortnight before arriving to this solution. For those not in the loop, `include` will decorate your class' instance methods with those found in the module. All sarcasm aside, this is the correct solution, and we should stop here.

```ruby
module Gluable
  def do_trick
    "http://elmers.com/"
  end
end

class Horse < Animal
  include Gluable
end

class Rabbit < Animal
  include Gluable
end
```

...instead, management now wants some _synergy_ every time `#some_special_hook` is run. Your developer thinks he is clever and produces this. Including a module into every subclass seems _sooooooo_ 2006. Instead, we can type `acts_as_gluable` in our subclass! How clever!

```ruby
module Gluable
  def self.included(other)
    other.extend(ClassMethods)
  end

  def do_trick
    "http://elmers.com/"
  end

  def some_special_hook
    # overly complex and poorly tested business logic
    super
  end

  module ClassMethods
    def acts_as_gluable
      include Gluable
    end
  end
end
```

## How NOT clever

Replace `Animal` with `ActiveRecord::Base` and prepare for the biggest clusterfuck you've ever seen. Everybody thinks it's fashionable to make crude monkeypatches to the base AR class and ends up bringing in `Railtie` dependencies when their library really focuses on adding two numbers or doing some geocoding. Here is an example of a geocoding library [doing a lot of not-geocoding](https://github.com/geokit/geokit-rails/blob/master/lib/geokit-rails/railtie.rb).

## Why is it a problem?

The DSL methods that they include to decorate your model with domain specific functionality now exists in *every model your project will ever have*. Additionally, the support required to do this patching/integration usually ends up adding either a large part of `active_support` or `rails` as a dependency. 

It is 2017. Myself and many other developers prefer to work on microservice oriented applications. If sharing a database is something that your architecture requires (not all of us do the most clever, 3489248923423-Kafka-shard with 8394248e+01 ElasticSearch cluster services), then you don't get to make portable models. Today while attempting to package all of our database models in an external gem, I had to read through the source of at least 5+ libraries to find out how to make their functions available without Rails. It isn't necissarily difficult to do -- but I noticed that most of the code was just to provide this convenient DSL sugar...and for no benefit at all.

I really don't mean to sound so angry, but not everybody uses Rails for everything anymore. And that's a good thing. Our ecosystem is maturing, finding alternatives, growing. Ruby's metaprogramming facilities make it so easy for someone to write all of this seemingly "automagic" software, with include and extend hooks, _great_ reflection support, and the whole 9 yards. It also makes it 100x easier for you to forget that you are committing abuses just becuase committing them is so much fun. If Ruby is to continue maturing, we need to exercise some self control as a community -- or Ruby will become a thing of the past. And wouldn't that be a damn shame.



